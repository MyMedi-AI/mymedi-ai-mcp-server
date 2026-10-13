/**
 * The --http mode over a real socket (port 0). Requests go through node:http
 * so a test can send any Host, Origin or body a hostile page or LAN host
 * could send.
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { afterEach, describe, it } from 'node:test';

import { createHttpServer, resolveHttpConfig, startHttp } from '../src/http.js';
import { createMcpServer } from '../src/index.js';

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-test', version: '1.0.0' } },
};
const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

const servers = [];

async function listen(options = {}) {
  const handle = createHttpServer({ createMcpServer: () => createMcpServer({ apiKey: '', apiBaseUrl: 'http://api.test' }), ...options });
  servers.push(handle);
  await new Promise((resolve) => handle.server.listen(0, '127.0.0.1', resolve));
  return { ...handle, port: handle.server.address().port };
}

function send(port, { method = 'POST', path = '/mcp', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
      }
    );
    req.on('error', reject);
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}

// Write raw bytes and keep the socket open: resolves with what came back
// and whether the server closed the connection within `waitMs`.
function rawExchange(port, payload, waitMs = 2000) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const socket = connect(port, '127.0.0.1', () => socket.write(payload));
    const finish = (closed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ closed, text: Buffer.concat(chunks).toString() });
    };
    const timer = setTimeout(() => finish(false), waitMs);
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', () => {}); // a reset after the answer is the server closing on us
    socket.on('close', () => finish(true));
  });
}

// A JSON-RPC answer arrives as JSON or as one SSE `data:` event.
function rpcResult(res) {
  if (!String(res.headers['content-type']).includes('text/event-stream')) return JSON.parse(res.text);
  const data = res.text.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(data.slice('data: '.length));
}

async function openSession(port, headers = {}) {
  const res = await send(port, { headers: { ...MCP_HEADERS, ...headers }, body: INIT });
  const sessionId = res.headers['mcp-session-id'];
  await send(port, {
    headers: { ...MCP_HEADERS, ...headers, 'mcp-session-id': sessionId },
    body: { jsonrpc: '2.0', method: 'notifications/initialized' },
  });
  return { res, sessionId };
}

afterEach(async () => {
  for (const { server, close } of servers.splice(0)) {
    if (close) await close();
    else await new Promise((resolve) => server.close(resolve));
  }
});

describe('--http: errors never take the process down', () => {
  it('should answer malformed JSON with a JSON-RPC parse error and keep serving', async () => {
    // Arrange
    const { port } = await listen({ log: () => {} });

    // Act
    const bad = await send(port, { headers: MCP_HEADERS, body: '{"jsonrpc": "2.0", "id": 1,' });
    const { res: next } = await openSession(port);

    // Assert
    assert.equal(bad.status, 400);
    assert.deepEqual(JSON.parse(bad.text), { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: the body is not valid JSON' }, id: null });
    assert.equal(next.status, 200);
  });

  it('should answer an error thrown while handling a request with a 500 that leaks no detail', async () => {
    // Arrange
    const logged = [];
    const { port } = await listen({ createMcpServer: () => { throw new Error('secret detail'); }, log: (line) => logged.push(line) });

    // Act
    const res = await send(port, { headers: MCP_HEADERS, body: INIT });

    // Assert
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(res.text), { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    assert.match(logged.join('\n'), /secret detail/);
  });
});

describe('--http: request bodies are capped', () => {
  const head = (port, extra) =>
    `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\n${extra}\r\n`;

  // The client below declares more than 1 MiB and then sends almost nothing:
  // the server must answer 413 and close the connection rather than wait (up
  // to the 300 s request timeout) to read and discard the rest.
  it('should refuse a declared body over 1 MiB with 413 and close the connection', async () => {
    // Arrange
    const { port } = await listen();

    // Act
    const { closed, text } = await rawExchange(port, `${head(port, `Content-Length: ${1024 * 1024 + 1}\r\n`)}{"jsonrpc":`);

    // Assert
    assert.match(text, /^HTTP\/1\.1 413 /);
    assert.match(text, /\r\nconnection: close\r\n/i);
    assert.match(text, /"message":"Request body too large \(limit 1048576 bytes\)"/);
    assert.equal(closed, true);
  });

  it('should read a body of exactly 1 MiB (then find it is not JSON)', async () => {
    const { port } = await listen();
    const res = await send(port, { headers: MCP_HEADERS, body: 'x'.repeat(1024 * 1024) });
    assert.equal(res.status, 400);
  });

  it('should refuse a chunked body once it grows past the limit, and close the connection', async () => {
    // Arrange
    const { port } = await listen({ maxBodyBytes: 1024 });

    // Act: one 2 KiB chunk, and no final chunk
    const { closed, text } = await rawExchange(port, `${head(port, 'Transfer-Encoding: chunked\r\n')}800\r\n${'x'.repeat(2048)}\r\n`);

    // Assert
    assert.match(text, /^HTTP\/1\.1 413 /);
    assert.equal(closed, true);
  });
});

describe('--http: sessions', () => {
  it('should open a session with initialize and serve tools/list on it', async () => {
    // Arrange
    const { port } = await listen();
    const { res, sessionId } = await openSession(port);

    // Act
    const list = await send(port, {
      headers: { ...MCP_HEADERS, 'mcp-session-id': sessionId },
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    });

    // Assert
    assert.equal(res.status, 200);
    assert.ok(sessionId);
    assert.equal(rpcResult(list).result.tools.length, 32);
  });

  // MCP spec: an unknown (expired, evicted, never issued) session id is 404,
  // which tells the client to initialize a new session.
  for (const method of ['POST', 'GET', 'DELETE']) {
    it(`should answer ${method} with an unknown session id with 404`, async () => {
      // Arrange
      const { port } = await listen();

      // Act
      const res = await send(port, {
        method,
        headers: { ...MCP_HEADERS, 'mcp-session-id': 'no-such-session' },
        body: method === 'POST' ? { jsonrpc: '2.0', id: 7, method: 'tools/list' } : undefined,
      });

      // Assert
      assert.equal(res.status, 404);
      assert.deepEqual(JSON.parse(res.text), {
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session not found' },
        id: method === 'POST' ? 7 : null,
      });
    });
  }

  for (const method of ['POST', 'GET', 'DELETE']) {
    it(`should answer ${method} without a session id (other than initialize) with 400`, async () => {
      const { port } = await listen();
      const res = await send(port, {
        method,
        headers: MCP_HEADERS,
        body: method === 'POST' ? { jsonrpc: '2.0', id: 8, method: 'tools/list' } : undefined,
      });
      assert.equal(res.status, 400);
      assert.equal(JSON.parse(res.text).error.message, 'Bad Request: Mcp-Session-Id header is required');
    });
  }

  it('should refuse a new session past the cap with 503', async () => {
    // Arrange
    const { port } = await listen({ maxSessions: 2 });
    await openSession(port);
    await openSession(port);

    // Act
    const res = await send(port, { headers: MCP_HEADERS, body: INIT });

    // Assert
    assert.equal(res.status, 503);
    assert.equal(JSON.parse(res.text).error.message, 'Server busy: too many active MCP sessions — retry later');
  });

  it('should reclaim idle sessions before refusing one', async () => {
    // Arrange: the one allowed session has been idle past the window (set
    // directly — a short real window would let the sweep timer race the test).
    const { port, sessions } = await listen({ maxSessions: 1 });
    const { sessionId: old } = await openSession(port);
    sessions.get(old).lastSeen -= 31 * 60 * 1000;

    // Act
    const res = await send(port, { headers: MCP_HEADERS, body: INIT });

    // Assert
    assert.equal(res.status, 200);
    assert.equal(sessions.size, 1);
    assert.ok(!sessions.has(old));
  });

  it('should evict sessions not seen within the idle window, and keep the ones in use', async () => {
    // Arrange
    const { port, sessions, evictIdleSessions } = await listen({ idleMs: 60_000 });
    const { sessionId } = await openSession(port);

    // Act
    const keptNow = await evictIdleSessions(Date.now());
    const evictedLater = await evictIdleSessions(Date.now() + 60_000);
    const after = await send(port, { headers: { ...MCP_HEADERS, 'mcp-session-id': sessionId }, body: { jsonrpc: '2.0', id: 3, method: 'tools/list' } });

    // Assert
    assert.equal(keptNow, 0);
    assert.equal(evictedLater, 1);
    assert.equal(sessions.size, 0);
    assert.equal(after.status, 404);
  });

  it('should close a session on DELETE and then answer its id with 404', async () => {
    // Arrange
    const { port, sessions } = await listen();
    const { sessionId } = await openSession(port);

    // Act
    const closed = await send(port, { method: 'DELETE', headers: { ...MCP_HEADERS, 'mcp-session-id': sessionId } });
    const after = await send(port, { method: 'GET', headers: { ...MCP_HEADERS, 'mcp-session-id': sessionId } });

    // Assert
    assert.equal(closed.status, 200);
    assert.equal(sessions.size, 0);
    assert.equal(after.status, 404);
  });
});

// A page on any site can make a browser send requests to 127.0.0.1, and a
// DNS-rebinding page can do it under its own hostname. The Host header
// names the site the browser thinks it is talking to.
describe('--http: Host allowlist', () => {
  it('should refuse a forged Host with 403, before anything else', async () => {
    // Arrange
    const { port } = await listen({ token: 'x'.repeat(32) });

    // Act
    const post = await send(port, { headers: { ...MCP_HEADERS, host: 'rebind.attacker.example' }, body: INIT });
    const preflight = await send(port, { method: 'OPTIONS', headers: { host: `rebind.attacker.example:${port}` } });

    // Assert
    assert.equal(post.status, 403);
    assert.equal(JSON.parse(post.text).error.message, 'Forbidden: Host not allowed');
    assert.equal(preflight.status, 403);
  });

  for (const host of ['localhost', 'localhost:PORT', '127.0.0.1:PORT', '[::1]:PORT']) {
    it(`should accept Host ${host}`, async () => {
      const { port } = await listen();
      const { res } = await openSession(port, { host: host.replace('PORT', String(port)) });
      assert.equal(res.status, 200);
    });
  }

  it('should accept a host from the allowlist with any port', async () => {
    const { port } = await listen({ allowedHosts: ['localhost', 'mcp.example.com'] });
    const { res } = await openSession(port, { host: 'mcp.example.com:443' });
    assert.equal(res.status, 200);
  });

  // (The SDK's request adapter itself refuses a Host whose case differs from
  // its parsed form with 400; the point here is that the guard does not.)
  it('should match the allowlist regardless of case or a trailing dot', async () => {
    const { port } = await listen({ allowedHosts: ['localhost', 'mcp.example.com'] });
    const statuses = await Promise.all(['MCP.Example.com', 'mcp.example.com.', 'LOCALHOST'].map(
      (host) => send(port, { headers: { ...MCP_HEADERS, host }, body: INIT }).then((res) => res.status)
    ));
    assert.ok(statuses.every((status) => status !== 403), String(statuses));
  });

  it('should refuse a request with no Host header (HTTP/1.0)', async () => {
    // Arrange
    const { port } = await listen();

    // Act
    const raw = await new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => socket.end('GET /mcp HTTP/1.0\r\n\r\n'));
      const chunks = [];
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
      socket.on('error', reject);
    });

    // Assert
    assert.match(raw, /^HTTP\/1\.[01] 403 /);
  });

  it('should build the allowlist from loopback names, MCP_ALLOWED_HOSTS and a specific MCP_HOST', () => {
    // Act
    const listed = resolveHttpConfig({ MCP_ALLOWED_HOSTS: ' a.example, B.example:8443 ' }).allowedHosts;
    const bound = resolveHttpConfig({ MCP_HOST: '192.168.1.10', MCP_HTTP_TOKEN: 'x'.repeat(32) }).allowedHosts;
    const wildcard = resolveHttpConfig({ MCP_HOST: '0.0.0.0', MCP_HTTP_TOKEN: 'x'.repeat(32) }).allowedHosts;

    // Assert
    assert.deepEqual(listed, ['localhost', '127.0.0.1', '::1', 'a.example', 'b.example']);
    assert.deepEqual(bound, ['localhost', '127.0.0.1', '::1', '192.168.1.10']);
    assert.deepEqual(wildcard, ['localhost', '127.0.0.1', '::1']);
  });
});

// MCP transport spec: an Origin that is present and not allowed gets 403.
// Desktop clients send no Origin; a browser always does.
describe('--http: Origin and CORS', () => {
  const INSPECTOR = 'http://localhost:6274';

  it('should refuse a request from another web origin with 403 and no CORS grant', async () => {
    // Arrange
    const { port } = await listen();

    // Act
    const res = await send(port, { headers: { ...MCP_HEADERS, origin: 'https://attacker.example' }, body: INIT });

    // Assert
    assert.equal(res.status, 403);
    assert.equal(JSON.parse(res.text).error.message, 'Forbidden: Origin not allowed');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('should refuse the opaque "null" origin of sandboxed pages and files', async () => {
    const { port } = await listen({ allowedOrigins: [INSPECTOR] });
    const res = await send(port, { headers: { ...MCP_HEADERS, origin: 'null' }, body: INIT });
    assert.equal(res.status, 403);
  });

  it('should serve an allowed origin and grant it, and only it, in CORS headers', async () => {
    // Arrange
    const { port } = await listen({ allowedOrigins: [INSPECTOR] });

    // Act
    const { res } = await openSession(port, { origin: INSPECTOR });

    // Assert
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], INSPECTOR);
    assert.match(res.headers.vary, /Origin/);
    assert.match(res.headers['access-control-expose-headers'], /Mcp-Session-Id/i);
  });

  it('should answer an allowed preflight without a token, naming the headers MCP clients send', async () => {
    // Arrange
    const { port } = await listen({ allowedOrigins: [INSPECTOR], token: 'x'.repeat(32) });

    // Act
    const res = await send(port, {
      method: 'OPTIONS',
      headers: { origin: INSPECTOR, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, mcp-session-id' },
    });

    // Assert
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], INSPECTOR);
    for (const header of ['Authorization', 'Mcp-Session-Id', 'Mcp-Protocol-Version', 'Content-Type']) {
      assert.match(res.headers['access-control-allow-headers'], new RegExp(header, 'i'));
    }
  });

  it('should grant the normalized origin, not the raw header it matched', async () => {
    // Arrange
    const { port } = await listen({ allowedOrigins: [INSPECTOR] });

    // Act
    const res = await send(port, {
      method: 'OPTIONS',
      headers: { origin: 'HTTP://LocalHost:6274', 'access-control-request-method': 'POST' },
    });

    // Assert
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], INSPECTOR);
  });

  it('should never grant every origin', async () => {
    const { port } = await listen();
    const { res } = await openSession(port);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('should read MCP_ALLOWED_ORIGINS as http(s) origins and refuse anything else', () => {
    assert.deepEqual(
      resolveHttpConfig({ MCP_ALLOWED_ORIGINS: 'http://localhost:6274, https://App.Example.com/' }).allowedOrigins,
      ['http://localhost:6274', 'https://app.example.com']
    );
    for (const bad of ['*', 'app.example.com', 'file:///tmp/x.html']) {
      assert.throws(() => resolveHttpConfig({ MCP_ALLOWED_ORIGINS: bad }), /MCP_ALLOWED_ORIGINS/);
    }
  });
});

describe('--http: bearer token (MCP_HTTP_TOKEN)', () => {
  const TOKEN = 'a'.repeat(24) + 'bearer-test-token-0001';

  it('should refuse a request without the token with 401 and a Bearer challenge', async () => {
    // Arrange
    const { port } = await listen({ token: TOKEN });

    // Act
    const res = await send(port, { headers: MCP_HEADERS, body: INIT });

    // Assert
    assert.equal(res.status, 401);
    assert.match(res.headers['www-authenticate'], /^Bearer /);
    assert.equal(JSON.parse(res.text).error.message, 'Unauthorized: send Authorization: Bearer <MCP_HTTP_TOKEN>');
  });

  it('should refuse a wrong token', async () => {
    const { port } = await listen({ token: TOKEN });
    const res = await send(port, { headers: { ...MCP_HEADERS, authorization: `Bearer ${TOKEN.slice(0, -1)}x` }, body: INIT });
    assert.equal(res.status, 401);
  });

  it('should serve a request that carries the token (scheme in any case)', async () => {
    // Arrange
    const { port } = await listen({ token: TOKEN });

    // Act
    const { res } = await openSession(port, { authorization: `bearer ${TOKEN}` });

    // Assert
    assert.equal(res.status, 200);
  });

  it('should not ask for a token on loopback when none is configured', async () => {
    const { port } = await listen();
    const { res } = await openSession(port);
    assert.equal(res.status, 200);
  });

  it('should refuse a token shorter than 32 characters', () => {
    assert.throws(() => resolveHttpConfig({ MCP_HTTP_TOKEN: 'short-token' }), /MCP_HTTP_TOKEN must be at least 32 characters/);
  });

  // A bearer value is one run of non-space characters, so a token with a
  // space, tab or newline inside could never be presented: refuse it at
  // startup rather than answer every request with 401.
  for (const [label, token] of [['a space', `${'a'.repeat(20)} ${'b'.repeat(20)}`], ['a tab', `${'a'.repeat(20)}\t${'b'.repeat(20)}`], ['a newline', `${'a'.repeat(20)}\n${'b'.repeat(20)}`]]) {
    it(`should refuse a token with ${label} inside`, () => {
      assert.throws(() => resolveHttpConfig({ MCP_HTTP_TOKEN: token }), /MCP_HTTP_TOKEN must not contain whitespace/);
    });
  }

  it('should accept a token with whitespace only around it (trimmed, e.g. read from a file)', () => {
    assert.equal(resolveHttpConfig({ MCP_HTTP_TOKEN: ` ${'c'.repeat(40)}\n` }).token, 'c'.repeat(40));
  });
});

describe('--http: where it listens', () => {
  it('should bind 127.0.0.1 by default and log the address it bound', async () => {
    // Arrange
    const logged = [];

    // Act
    const server = startHttp({ createMcpServer, env: { MCP_PORT: '0' }, log: (line) => logged.push(line) });
    servers.push({ server });
    await once(server, 'listening');

    // Assert
    const { address, port } = server.address();
    assert.equal(address, '127.0.0.1');
    assert.match(logged.join('\n'), new RegExp(`listening on http://127\\.0\\.0\\.1:${port}/mcp`));
  });

  it('should take the address from MCP_HOST, IPv6 brackets optional', () => {
    assert.deepEqual(
      [resolveHttpConfig({}), resolveHttpConfig({ MCP_HOST: 'localhost' }), resolveHttpConfig({ MCP_HOST: '[::1]' })].map((c) => c.host),
      ['127.0.0.1', 'localhost', '::1']
    );
  });

  for (const host of ['0.0.0.0', '::', '192.168.1.10', 'mcp.example.com']) {
    it(`should refuse to listen on ${host} without MCP_HTTP_TOKEN`, () => {
      assert.throws(() => resolveHttpConfig({ MCP_HOST: host }), /is not a loopback address: set MCP_HTTP_TOKEN/);
    });
  }

  it('should listen off loopback when a token is set', () => {
    assert.equal(resolveHttpConfig({ MCP_HOST: '0.0.0.0', MCP_HTTP_TOKEN: 'x'.repeat(32) }).host, '0.0.0.0');
  });

  for (const host of ['127.0.0.1', '127.8.9.10', 'localhost', '::1', '[::1]', '::ffff:127.0.0.1']) {
    it(`should treat ${host} as loopback (no token needed)`, () => {
      assert.doesNotThrow(() => resolveHttpConfig({ MCP_HOST: host }));
    });
  }

  for (const port of ['abc', '-1', '70000', '80.5']) {
    it(`should refuse to start on MCP_PORT=${port}`, () => {
      assert.throws(() => resolveHttpConfig({ MCP_PORT: port }), /MCP_PORT must be a whole number from 0 to 65535/);
    });
  }
});

describe('--http: configuration from the environment', () => {
  it('should read the session cap and idle window, defaulting to 100 sessions and 30 minutes', () => {
    assert.deepEqual(
      [resolveHttpConfig({ MCP_MAX_SESSIONS: '5', MCP_SESSION_IDLE_MS: '1000' }), resolveHttpConfig({ MCP_MAX_SESSIONS: 'lots' })]
        .map(({ maxSessions, idleMs }) => [maxSessions, idleMs]),
      [[5, 1000], [100, 30 * 60 * 1000]]
    );
  });
});
