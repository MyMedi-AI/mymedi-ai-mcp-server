/**
 * The npm server driven through the real SDK client over an in-memory
 * transport — what a client sees at initialize and on each call.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer, createSandboxServer } from '../src/index.js';
import { SERVER_INSTRUCTIONS } from '../src/tools.js';

const API = 'http://api.test';

async function connect(server) {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

describe('initialize', () => {
  let client;
  let server;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  it('should send the server instructions', async () => {
    // Arrange
    server = createMcpServer({ apiKey: '', apiBaseUrl: API });

    // Act
    client = await connect(server);

    // Assert
    assert.equal(client.getInstructions(), SERVER_INSTRUCTIONS);
  });

  it('should send the server instructions from the sandbox server too', async () => {
    // Arrange
    server = createSandboxServer();

    // Act
    client = await connect(server);

    // Assert
    assert.equal(client.getInstructions(), SERVER_INSTRUCTIONS);
  });
});

describe('credentials from the environment', () => {
  const saved = { ...process.env };
  let client;
  let server;

  afterEach(async () => {
    await client?.close();
    await server?.close();
    mock.restoreAll();
    for (const name of ['MCP_API_KEY', 'MYMEDI_API_KEY', 'MCP_API_BASE_URL']) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('should bill the MYMEDI_API_KEY alias when MCP_API_KEY is unset', async () => {
    // Arrange
    delete process.env.MCP_API_KEY;
    process.env.MYMEDI_API_KEY = 'mmai-alias-key';
    process.env.MCP_API_BASE_URL = API;
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }));
    server = createMcpServer();
    client = await connect(server);

    // Act
    await client.callTool({ name: 'code_lookup', arguments: { code: 'E0601' } });

    // Assert
    const [url, init] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, `${API}/agent/v1/codes/lookup`);
    assert.equal(init.headers['X-API-Key'], 'mmai-alias-key');
  });
});
