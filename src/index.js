#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { MCP_TOOLS, getToolByName } from './tools.js';

const API_BASE_URL = process.env.MCP_API_BASE_URL || 'https://mymedi-ai.com';
const API_KEY = process.env.MCP_API_KEY || '';

// Shared server instance for stdio mode
const server = createMcpServer();

function createMcpServer() {
  const s = new McpServer({ name: 'mymedi-ai', version: '1.3.0' });
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
          response = await fetch(`${API_BASE_URL}${toolDef.endpoint}${pathSuffix}${queryString ? `?${queryString}` : ''}`, {
            method: 'GET',
            headers: {
              ...(API_KEY && { 'X-API-Key': API_KEY }),
              'X-Agent-ID': 'mcp-client',
              'User-Agent': '@mymedi-ai/mcp-server/1.3.0',
            },
          });
        } else {
          response = await fetch(`${API_BASE_URL}${toolDef.endpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(API_KEY && { 'X-API-Key': API_KEY }),
              'X-Agent-ID': 'mcp-client',
              'User-Agent': '@mymedi-ai/mcp-server/1.3.0',
            },
            body: JSON.stringify(params),
          });
        }
        if (response.status === 402) {
          const paymentInfo = await response.json();
          return {
            content: [{ type: 'text', text: JSON.stringify({
              error: 'payment_required',
              message: `This tool costs ${toolDef.price} per call. Register at ${API_BASE_URL}/bot-marketplace/register for an API key with 100 free starter credits, or pay per call with on-chain USDC (no signup) via the x402 protocol.`,
              price: toolDef.price, register: `${API_BASE_URL}/bot-marketplace/register`, ...paymentInfo,
            }, null, 2) }], isError: true,
          };
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
  return s;
}

// Smithery sandbox support — allows scanning tools without real credentials
export function createSandboxServer() {
  const sandboxServer = new McpServer({ name: 'mymedi-ai', version: '1.3.0' });
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

async function startStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp() {
  const port = parseInt(process.env.MCP_PORT || '8080', 10);
  const transports = {};

  const httpServer = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. Use POST /mcp' }));
      return;
    }

    if (req.method === 'GET') {
      const sessionId = req.headers['mcp-session-id'];
      const transport = sessionId && transports[sessionId];
      if (transport) {
        await transport.handleRequest(req, res);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No session. Send initialize request first.' }));
      }
      return;
    }

    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'];
      const transport = sessionId && transports[sessionId];
      if (transport) {
        await transport.handleRequest(req, res);
      } else {
        res.writeHead(204);
        res.end();
      }
      return;
    }

    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      req.body = body;

      const sessionId = req.headers['mcp-session-id'];

      if (sessionId && transports[sessionId]) {
        await transports[sessionId].handleRequest(req, res, body);
        return;
      }

      if (!sessionId && isInitializeRequest(body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => { transports[sid] = transport; },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) delete transports[sid];
        };
        const mcpServer = createMcpServer();
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID' }, id: null }));
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  });

  httpServer.listen(port, () => {
    console.error(`MCP HTTP server listening on http://localhost:${port}/mcp`);
  });
}

// Only auto-connect when run directly (not imported for scanning)
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('index.js') ||
  process.argv[1].endsWith('mymedi-ai-mcp')
);
if (isDirectRun) {
  const useHttp = process.argv.includes('--http') || process.env.MCP_HTTP === '1';
  if (useHttp) {
    startHttp();
  } else {
    startStdio();
  }
}
