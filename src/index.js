#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveApiBaseUrl, resolveApiKey, resolveConnectorToken } from './config.js';
import { startHttp } from './http.js';
import { formatPaymentRequired } from './paymentRequired.js';
import { MCP_PROMPTS } from './prompts.js';
import { RESOURCE_DEFS, readApiText, readPublicText } from './resources.js';
import { MCP_TOOLS, SERVER_INSTRUCTIONS, getToolByName } from './tools.js';

// Read from package.json rather than restated here: this was hardcoded '1.5.0'
// while package.json shipped 1.7.2, so the MCP handshake and User-Agent had
// been advertising a version two minors stale since 9358f26.
const SERVER_VERSION = createRequire(import.meta.url)('../package.json').version;

function makeBaseHeaders({ apiKey, connectorToken }) {
  return (extra = {}) => ({
    ...(apiKey && { 'X-API-Key': apiKey }),
    ...(connectorToken && { 'X-Connector-Token': connectorToken }),
    'X-Agent-ID': 'mcp-client',
    'User-Agent': `@mymedi-ai/mcp-server/${SERVER_VERSION}`,
    ...extra,
  });
}

/**
 * One MCP server: the tools, prompts and resources, with the server
 * instructions sent at initialize. Credentials default to the environment;
 * the HTTP mode builds one server per session.
 *
 * @param {object} [options]
 * @param {string} [options.apiKey] - billed API key (default MCP_API_KEY, or MYMEDI_API_KEY)
 * @param {string} [options.apiBaseUrl] - REST API base (default MCP_API_BASE_URL)
 * @param {string} [options.connectorToken] - shared-egress token (default MCP_CONNECTOR_TOKEN)
 * @returns {McpServer}
 */
export function createMcpServer({
  apiKey = resolveApiKey(),
  apiBaseUrl = resolveApiBaseUrl(),
  connectorToken = resolveConnectorToken(),
} = {}) {
  const baseHeaders = makeBaseHeaders({ apiKey, connectorToken });
  const s = new McpServer({ name: 'mymedi-ai', version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  for (const tool of MCP_TOOLS) {
    s.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.schema,
      annotations: tool.annotations,
    }, async (params) => {
      const toolDef = getToolByName(tool.name);
      if (!toolDef) {
        return { content: [{ type: 'text', text: `Unknown tool: ${tool.name}` }], isError: true };
      }
      try {
        let response;
        if (toolDef.method === 'GET') {
          // Free no-auth tools — GET with path/query params, no body, no Content-Type
          const pathSuffix = toolDef.pathParam ? `/${encodeURIComponent(params[toolDef.pathParam])}` : '';
          const query = new URLSearchParams();
          for (const [key, value] of Object.entries(params)) {
            if (key === toolDef.pathParam || value === undefined) continue;
            query.set(key, String(value));
          }
          const queryString = query.toString();
          response = await fetch(`${apiBaseUrl}${toolDef.endpoint}${pathSuffix}${queryString ? `?${queryString}` : ''}`, {
            method: 'GET',
            headers: baseHeaders(),
          });
        } else {
          response = await fetch(`${apiBaseUrl}${toolDef.endpoint}`, {
            method: 'POST',
            headers: baseHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(params),
          });
        }
        if (response.status === 402) {
          const paymentInfo = await response.json().catch(() => ({}));
          return formatPaymentRequired({ toolDef, paymentInfo, apiKey, apiBaseUrl });
        }
        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: response.statusText }));
          return { content: [{ type: 'text', text: JSON.stringify({ error: true, status: response.status, ...error }, null, 2) }], isError: true };
        }
        const data = await response.json();
        const creditsSpent = response.headers.get('X-Credits-Spent');
        const creditsRemaining = response.headers.get('X-Credits-Remaining');
        if (creditsSpent) {
          data._billing = { creditsSpent: parseInt(creditsSpent, 10), creditsRemaining: creditsRemaining ? parseInt(creditsRemaining, 10) : undefined, priceUSD: toolDef.price };
        }
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message, hint: 'Ensure MCP_API_BASE_URL and MCP_API_KEY environment variables are set.' }, null, 2) }], isError: true };
      }
    });
  }
  registerPrompts(s);
  registerResources(s, { apiBaseUrl, baseHeaders });
  return s;
}

function registerPrompts(s) {
  for (const prompt of MCP_PROMPTS) {
    s.registerPrompt(prompt.name, {
      title: prompt.title,
      description: prompt.description,
      argsSchema: prompt.argsSchema,
    }, (args) => ({ messages: prompt.buildMessages(args) }));
  }
}

function registerResources(s, { apiBaseUrl, baseHeaders }) {
  for (const def of RESOURCE_DEFS) {
    s.registerResource(def.name, def.uri, {
      title: def.title,
      description: def.description,
      mimeType: def.mimeType,
    }, async (uri) => {
      const text = def.publicPath
        ? await readPublicText(def)
        : await readApiText(def, { apiBaseUrl, headers: baseHeaders() });
      return { contents: [{ uri: uri.href, mimeType: def.mimeType, text }] };
    });
  }
}

// Smithery sandbox support — allows scanning tools without real credentials
export function createSandboxServer() {
  const sandboxServer = new McpServer({ name: 'mymedi-ai', version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  for (const tool of MCP_TOOLS) {
    sandboxServer.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.schema,
      annotations: tool.annotations,
    }, async () => ({ content: [{ type: 'text', text: 'sandbox' }] }));
  }
  return sandboxServer;
}

/**
 * Whether this module is the program Node was started with — `node
 * src/index.js`, or the npx bin link to it — and not a module some other
 * program imports. Compares real paths: a check on the file name alone
 * started a stdio server inside any program whose own entry is index.js.
 *
 * @param {string | undefined} [entry] - process.argv[1]
 * @param {string} [moduleUrl] - import.meta.url of this module
 * @returns {boolean}
 */
export function isMainModule(entry = process.argv[1], moduleUrl = import.meta.url) {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

async function startStdio() {
  const transport = new StdioServerTransport();
  await createMcpServer().connect(transport);
}

// Start a server only when run directly — never when imported (Smithery's
// scanner, or a program embedding the package).
if (isMainModule()) {
  const useHttp = process.argv.includes('--http') || process.env.MCP_HTTP === '1';
  if (useHttp) {
    try {
      startHttp({ createMcpServer });
    } catch (err) {
      console.error(`MCP HTTP server not started: ${err.message}`);
      process.exitCode = 1;
    }
  } else {
    startStdio();
  }
}
