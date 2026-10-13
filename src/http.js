/**
 * Streamable HTTP mode (`--http`, or MCP_HTTP=1): one MCP server per session
 * behind a single /mcp endpoint.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

/** A setting that would make the HTTP mode unsafe or unusable. */
export class HttpConfigError extends Error {}

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8080;
export const MIN_TOKEN_LENGTH = 32;
export const MAX_BODY_BYTES = 1024 * 1024;
export const DEFAULT_MAX_SESSIONS = 100;
export const DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1000;
export const LOOPBACK_HOSTNAMES = Object.freeze(['localhost', '127.0.0.1', '::1']);
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::']);

const stripBrackets = (host) => host.replace(/^\[(.*)\]$/, '$1');

/**
 * Whether a listen address is reachable only from this machine.
 * @param {string} host
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  const h = stripBrackets(String(host)).toLowerCase();
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h) || /^::ffff:127(\.\d{1,3}){3}$/.test(h);
}

/**
 * The hostname a Host header (or an allowlist entry) names, lower-cased,
 * without port, brackets or a trailing dot; '' when it cannot be read.
 * @param {string | undefined} value
 * @returns {string}
 */
export function hostnameOf(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v.startsWith('[')) {
    const end = v.indexOf(']');
    return end > 1 ? v.slice(1, end) : '';
  }
  const colon = v.indexOf(':');
  if (colon !== -1 && v.indexOf(':', colon + 1) !== -1) return v; // bare IPv6 (an allowlist entry)
  return (colon === -1 ? v : v.slice(0, colon)).replace(/\.$/, '');
}

/**
 * The serialized origin of an http(s) URL ('https://app.example.com'); ''
 * for anything else, including the opaque "null" origin.
 * @param {string | undefined} value
 * @returns {string}
 */
export function originOf(value) {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
}

const unique = (values) => [...new Set(values.filter(Boolean))];
const listFromEnv = (value) => String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);

const positiveInt = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Read the HTTP mode's settings. The server listens on loopback
 * (127.0.0.1) unless MCP_HOST says otherwise, and any other address needs
 * MCP_HTTP_TOKEN.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ host: string, port: number, token: string, allowedOrigins: string[], allowedHosts: string[], maxSessions: number, idleMs: number }}
 * @throws {HttpConfigError}
 */
export function resolveHttpConfig(env = process.env) {
  const host = stripBrackets(String(env.MCP_HOST ?? '').trim()) || DEFAULT_HOST;
  const rawPort = String(env.MCP_PORT ?? '').trim() || String(DEFAULT_PORT);
  if (!/^\d+$/.test(rawPort) || Number(rawPort) > 65535) {
    throw new HttpConfigError(`MCP_PORT must be a whole number from 0 to 65535 (got "${rawPort}")`);
  }
  const token = String(env.MCP_HTTP_TOKEN ?? '').trim();
  if (token && token.length < MIN_TOKEN_LENGTH) {
    throw new HttpConfigError(`MCP_HTTP_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters (for example: openssl rand -hex 32)`);
  }
  // A bearer value is one run of non-space characters: a token with
  // whitespace inside could never be presented, and every request would 401.
  if (/\s/.test(token)) {
    throw new HttpConfigError('MCP_HTTP_TOKEN must not contain whitespace (for example: openssl rand -hex 32)');
  }
  // Off loopback, anyone who can reach the port would spend the operator's
  // MCP_API_KEY — so that takes a token, or the server does not start.
  if (!isLoopbackHost(host) && !token) {
    throw new HttpConfigError(`MCP_HOST=${host} is not a loopback address: set MCP_HTTP_TOKEN (at least ${MIN_TOKEN_LENGTH} characters) so only clients holding it can call the server`);
  }
  const allowedOrigins = listFromEnv(env.MCP_ALLOWED_ORIGINS).map((entry) => {
    const origin = originOf(entry);
    if (!origin) {
      throw new HttpConfigError(`MCP_ALLOWED_ORIGINS: "${entry}" is not an http(s) origin such as https://app.example.com`);
    }
    return origin;
  });
  return {
    host,
    port: Number(rawPort),
    token,
    allowedOrigins: unique(allowedOrigins),
    // The names a client may use for this server. A specific MCP_HOST is
    // included; a wildcard (0.0.0.0, ::) is not a name anyone browses to.
    allowedHosts: unique([
      ...LOOPBACK_HOSTNAMES,
      ...listFromEnv(env.MCP_ALLOWED_HOSTS).map(hostnameOf),
      WILDCARD_HOSTS.has(host) ? '' : hostnameOf(host.includes(':') ? `[${host}]` : host),
    ]),
    maxSessions: positiveInt(env.MCP_MAX_SESSIONS, DEFAULT_MAX_SESSIONS),
    idleMs: positiveInt(env.MCP_SESSION_IDLE_MS, DEFAULT_SESSION_IDLE_MS),
  };
}

const endpointUrl = (address, port) => `http://${address.includes(':') ? `[${address}]` : address}:${port}/mcp`;

class BodyTooLargeError extends Error {}

/**
 * Read a request body of at most `limit` bytes. A declared Content-Length
 * over the limit is refused before reading; a chunked body is counted as it
 * arrives. Past the limit nothing more is kept: the caller answers 413 with
 * Connection: close, and Node closes the socket once that answer is sent.
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      reject(new BodyTooLargeError());
      return;
    }
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

const sendJsonRpcError = (res, status, code, message, { id = null, headers = {} } = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id }));
};

// Compare digests, not the strings: timingSafeEqual needs equal lengths, and
// hashing first keeps the comparison from leaking the token's length.
const digest = (value) => createHash('sha256').update(value).digest();

function bearerMatches(header, token) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(String(header ?? ''));
  return Boolean(match) && timingSafeEqual(digest(match[1]), digest(token));
}

// The JSON-RPC id of a single request body, so an error can answer it.
const requestId = (body) =>
  body && typeof body === 'object' && !Array.isArray(body) && (typeof body.id === 'string' || typeof body.id === 'number')
    ? body.id
    : null;

/**
 * @param {object} options
 * @param {() => import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} options.createMcpServer
 * @param {(line: string) => void} [options.log] - operator log (stderr by default)
 * @param {number} [options.maxBodyBytes] - largest POST body read (default 1 MiB)
 * @param {number} [options.maxSessions] - open sessions at most (default 100)
 * @param {number} [options.idleMs] - a session unused this long is closed (default 30 min)
 * @param {string} [options.token] - when set, every request must carry Authorization: Bearer <token>
 * @param {string[]} [options.allowedHosts] - hostnames the Host header may name (default: loopback names)
 * @param {string[]} [options.allowedOrigins] - browser origins allowed to call (default: none)
 * @returns {{
 *   server: import('node:http').Server,
 *   sessions: Map<string, { transport: StreamableHTTPServerTransport, lastSeen: number }>,
 *   evictIdleSessions: (now?: number) => Promise<number>,
 *   close: () => Promise<void>,
 * }}
 */
export function createHttpServer({
  createMcpServer,
  log = console.error,
  maxBodyBytes = MAX_BODY_BYTES,
  maxSessions = DEFAULT_MAX_SESSIONS,
  idleMs = DEFAULT_SESSION_IDLE_MS,
  token = '',
  allowedHosts = LOOPBACK_HOSTNAMES,
  allowedOrigins = [],
}) {
  const hostAllowed = new Set(allowedHosts.map(hostnameOf));
  const originAllowed = new Set(allowedOrigins.map(originOf).filter(Boolean));

  // Every initialize allocates a transport and an MCP server that used to
  // live until the client sent DELETE, so sessions piled up without bound.
  // Now: a cap, idle eviction, and a sweep (as the hosted connector does).
  const sessions = new Map(); // sessionId -> { transport, lastSeen }

  async function closeSession(sid, entry) {
    sessions.delete(sid);
    try {
      await entry.transport.close();
    } catch (err) {
      log(`MCP session close failed: ${err?.message ?? err}`);
    }
  }

  async function evictIdleSessions(now = Date.now()) {
    let evicted = 0;
    for (const [sid, entry] of [...sessions]) {
      if (now - entry.lastSeen < idleMs) continue;
      evicted += 1;
      await closeSession(sid, entry);
    }
    return evicted;
  }

  // Every request runs inside this catch: a rejected handler used to be an
  // unhandled rejection, which ends a Node process — one malformed POST was
  // enough to stop the server. Details go to the operator log, never to the
  // client.
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      log(`MCP HTTP request failed: ${err?.stack ?? err}`);
      if (!res.headersSent) sendJsonRpcError(res, 500, -32603, 'Internal server error');
      else res.end();
    });
  });

  async function handle(req, res) {
    // DNS rebinding: a page can make a browser send requests here under its
    // own hostname. Only names this server answers to get past this line.
    if (!hostAllowed.has(hostnameOf(req.headers.host))) {
      sendJsonRpcError(res, 403, -32000, 'Forbidden: Host not allowed');
      return;
    }

    // MCP transport spec: an Origin that is present and not allowed gets 403.
    // Desktop clients send none; a browser always does, so only the origins
    // in MCP_ALLOWED_ORIGINS can call from a web page — and only they are
    // ever named in a CORS grant (never "*").
    res.setHeader('Vary', 'Origin');
    const { origin } = req.headers;
    if (origin !== undefined) {
      const allowed = originOf(origin);
      if (!originAllowed.has(allowed)) {
        sendJsonRpcError(res, 403, -32000, 'Forbidden: Origin not allowed');
        return;
      }
      // The serialized origin that matched the allowlist, never the raw
      // header text, goes back in the grant.
      res.setHeader('Access-Control-Allow-Origin', allowed);
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    }

    if (req.method === 'OPTIONS') {
      if (origin !== undefined) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      res.writeHead(204);
      res.end();
      return;
    }

    // Every request spends the operator's MCP_API_KEY, so when a token is
    // configured nothing is served without it. (A CORS preflight above
    // carries no credentials by design.)
    if (token && !bearerMatches(req.headers.authorization, token)) {
      sendJsonRpcError(res, 401, -32000, 'Unauthorized: send Authorization: Bearer <MCP_HTTP_TOKEN>', {
        headers: { 'WWW-Authenticate': 'Bearer realm="mymedi-ai-mcp"' },
      });
      return;
    }

    if (req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. Use POST /mcp' }));
      return;
    }

    if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, POST, DELETE, OPTIONS' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body;
    if (req.method === 'POST') {
      let raw;
      try {
        raw = await readBody(req, maxBodyBytes);
      } catch (err) {
        if (!(err instanceof BodyTooLargeError)) throw err;
        // Close rather than keep reading: draining the rest of an oversized
        // body would hold the connection for up to the 300 s request timeout.
        sendJsonRpcError(res, 413, -32600, `Request body too large (limit ${maxBodyBytes} bytes)`, {
          headers: { Connection: 'close' },
        });
        return;
      }
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        sendJsonRpcError(res, 400, -32700, 'Parse error: the body is not valid JSON');
        return;
      }
    }

    const sessionId = req.headers['mcp-session-id'];
    if (sessionId) {
      const entry = sessions.get(sessionId);
      // MCP spec: an unknown (expired, evicted, never issued) session id is
      // 404, which tells the client to initialize a new session.
      if (!entry) {
        sendJsonRpcError(res, 404, -32001, 'Session not found', { id: requestId(body) });
        return;
      }
      entry.lastSeen = Date.now();
      await entry.transport.handleRequest(req, res, body);
      return;
    }

    // Only a POST initialize without a session id opens a session.
    if (req.method === 'POST' && isInitializeRequest(body)) {
      // At the cap: reclaim idle sessions first, then refuse.
      if (sessions.size >= maxSessions) await evictIdleSessions();
      if (sessions.size >= maxSessions) {
        log(`MCP session cap reached (${maxSessions}); refusing an initialize`);
        sendJsonRpcError(res, 503, -32000, 'Server busy: too many active MCP sessions — retry later', { id: requestId(body) });
        return;
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => { sessions.set(sid, { transport, lastSeen: Date.now() }); },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };
      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    sendJsonRpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required', { id: requestId(body) });
  }

  // Sweep once a minute (sooner when the idle window is shorter); unref()
  // so the timer never keeps a process alive on its own.
  let sweeper = null;
  server.on('listening', () => {
    sweeper = setInterval(() => {
      evictIdleSessions().catch((err) => log(`MCP idle eviction failed: ${err?.message ?? err}`));
    }, Math.min(idleMs, 60 * 1000));
    sweeper.unref();
  });
  server.on('close', () => clearInterval(sweeper));

  async function close() {
    for (const [sid, entry] of [...sessions]) await closeSession(sid, entry);
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, sessions, evictIdleSessions, close };
}

/**
 * Start the HTTP mode from the environment.
 *
 * @param {object} options
 * @param {() => import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} options.createMcpServer
 * @param {Record<string, string | undefined>} [options.env]
 * @param {(line: string) => void} [options.log]
 * @returns {import('node:http').Server}
 * @throws {HttpConfigError} before listening, when a setting is unsafe or invalid
 */
export function startHttp({ createMcpServer, env = process.env, log = console.error }) {
  const { host, port, token, allowedHosts, allowedOrigins, maxSessions, idleMs } = resolveHttpConfig(env);
  const { server } = createHttpServer({ createMcpServer, log, maxSessions, idleMs, token, allowedHosts, allowedOrigins });
  server.on('error', (err) => {
    log(`MCP HTTP server error: ${err.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const { address, port: bound } = server.address();
    log(`MCP HTTP server listening on ${endpointUrl(address, bound)}${token ? ' (bearer token required)' : ''}`);
  });
  return server;
}
