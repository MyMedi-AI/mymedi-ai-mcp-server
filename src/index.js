#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MCP_TOOLS, getToolByName } from './tools.js';

const SERVER_VERSION = '1.4.0';
const API_BASE_URL = process.env.MCP_API_BASE_URL || 'https://mymedi-ai.com';
const API_KEY = process.env.MCP_API_KEY || '';
// Shared-egress deployments (e.g. the hosted claude.ai connector) set
// MCP_CONNECTOR_TOKEN so the API can give them an elevated rate-limit bucket
// instead of the per-IP one. Not needed for individual installs.
const CONNECTOR_TOKEN = process.env.MCP_CONNECTOR_TOKEN || '';

function baseHeaders(extra = {}) {
  return {
    ...(API_KEY && { 'X-API-Key': API_KEY }),
    ...(CONNECTOR_TOKEN && { 'X-Connector-Token': CONNECTOR_TOKEN }),
    'X-Agent-ID': 'mcp-client',
    'User-Agent': `@mymedi-ai/mcp-server/${SERVER_VERSION}`,
    ...extra,
  };
}

const RESOURCE_DEFS = [
  {
    name: 'pa-required-list',
    uri: 'mymedi://datasets/pa-required-list',
    title: 'Medicare DMEPOS Required Prior Authorization List',
    description: 'Full CMS Required Prior Authorization List (42 CFR 414.234): HCPCS codes with category and nationwide-since date. Original Medicare FFS scope.',
    mimeType: 'application/json',
    fetchPath: '/agent/v1/codes/pa-required-list',
  },
  {
    name: 'f2f-wopd-list',
    uri: 'mymedi://datasets/f2f-wopd-list',
    title: 'Medicare F2F + WOPD requirements list',
    description: 'Full CMS face-to-face encounter and written-order-prior-to-delivery list (42 CFR 410.38(d)) plus the universal standard written order elements.',
    mimeType: 'application/json',
    fetchPath: '/agent/v1/codes/f2f-wopd-list',
  },
  {
    name: 'llms-txt',
    uri: 'https://mymedi-ai.com/llms.txt',
    title: 'MyMedi-AI platform overview (llms.txt)',
    description: 'What MyMedi-AI is, the tool catalog, pricing, and integration paths — written for AI agents.',
    mimeType: 'text/plain',
    fetchPath: '/llms.txt',
  },
];

// Shared server instance for stdio mode
const server = createMcpServer();

function createMcpServer() {
  const s = new McpServer({ name: 'mymedi-ai', version: SERVER_VERSION });
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
            headers: baseHeaders(),
          });
        } else {
          response = await fetch(`${API_BASE_URL}${toolDef.endpoint}`, {
            method: 'POST',
            headers: baseHeaders({ 'Content-Type': 'application/json' }),
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
  registerPrompts(s);
  registerResources(s);
  return s;
}

function registerPrompts(s) {
  s.registerPrompt('decode-denial', {
    title: 'Decode a DME claim denial',
    description: 'Explain a CARC denial code and build an action plan to fix, resubmit, or appeal the claim.',
    argsSchema: { code: z.string().describe('CARC denial code (e.g., "CO-50")') },
  }, ({ code }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `A DME claim came back with denial code ${code}. Use the denial_code_info tool to decode it, then give me: (1) what this denial means in plain language, (2) the most likely root causes for a DME supplier, (3) concrete fix-and-resubmit steps in priority order, and (4) whether an appeal is worthwhile. Do not include any patient identifiers in tool calls.`,
      },
    }],
  }));

  s.registerPrompt('order-readiness', {
    title: 'DMEPOS order-readiness review',
    description: 'Assemble the blank pre-delivery paperwork checklist for a HCPCS code: SWO elements, F2F/WOPD, and prior authorization.',
    argsSchema: { code: z.string().describe('HCPCS Level II code (e.g., "E0466")') },
  }, ({ code }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `I am preparing a Medicare DMEPOS order for HCPCS code ${code}. Use the order_readiness_checklist tool to pull every documentation requirement, then present a blank pre-delivery checklist: the standard written order elements, any face-to-face encounter / WOPD requirement with its timing rule, and whether prior authorization must be affirmed before delivery. Flag the items suppliers most often miss. Keep it PHI-free — requirement definitions only, no patient data.`,
      },
    }],
  }));
}

function registerResources(s) {
  for (const def of RESOURCE_DEFS) {
    s.registerResource(def.name, def.uri, {
      title: def.title,
      description: def.description,
      mimeType: def.mimeType,
    }, async (uri) => {
      const response = await fetch(`${API_BASE_URL}${def.fetchPath}`, {
        method: 'GET',
        headers: baseHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${def.fetchPath}: HTTP ${response.status}`);
      }
      const text = await response.text();
      return { contents: [{ uri: uri.href, mimeType: def.mimeType, text }] };
    });
  }
}

// Smithery sandbox support — allows scanning tools without real credentials
export function createSandboxServer() {
  const sandboxServer = new McpServer({ name: 'mymedi-ai', version: SERVER_VERSION });
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
