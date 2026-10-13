/**
 * The three resources as a client reads them. The CMS lists come from the
 * API; llms.txt lives on the public site, with a timeout, a one-hour cache
 * and a static summary when the site cannot answer.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../src/index.js';
import { RESOURCE_DEFS, clearResourceCache, readPublicText, PUBLIC_TEXT_TTL_MS } from '../src/resources.js';

const API = 'http://api.test';
const LLMS = 'https://mymedi-ai.com/llms.txt';
const llms = RESOURCE_DEFS.find((def) => def.uri === LLMS);
const textResponse = (body, status = 200, type = 'text/plain; charset=utf-8') =>
  new Response(body, { status, headers: { 'Content-Type': type } });

describe('resources over MCP', () => {
  let client;
  let server;

  beforeEach(async () => {
    clearResourceCache();
    server = createMcpServer({ apiKey: 'mmai-test-key', apiBaseUrl: API, connectorToken: '' });
    client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    mock.restoreAll();
  });

  it('should list the three resources', async () => {
    const { resources } = await client.listResources();
    assert.deepEqual(resources.map((r) => r.uri), RESOURCE_DEFS.map((def) => def.uri));
  });

  it('should read a CMS list from the API with the configured key', async () => {
    // Arrange
    const fetchMock = mock.method(globalThis, 'fetch', async () => textResponse('{"codes":[]}', 200, 'application/json'));

    // Act
    const res = await client.readResource({ uri: 'mymedi://datasets/pa-required-list' });

    // Assert
    const [url, init] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, `${API}/agent/v1/codes/pa-required-list`);
    assert.equal(init.headers['X-API-Key'], 'mmai-test-key');
    assert.equal(res.contents[0].text, '{"codes":[]}');
  });

  it('should read llms.txt from the public site, not the API base URL', async () => {
    // Arrange
    const fetchMock = mock.method(globalThis, 'fetch', async () => textResponse('# MyMedi-AI\n> overview'));

    // Act
    const res = await client.readResource({ uri: LLMS });

    // Assert
    assert.equal(fetchMock.mock.calls[0].arguments[0], LLMS);
    assert.match(res.contents[0].text, /^# MyMedi-AI/);
  });

  it('should answer llms.txt with the static summary when the site cannot', async () => {
    // Arrange
    mock.method(globalThis, 'fetch', async () => textResponse('Not Found', 404));

    // Act
    const res = await client.readResource({ uri: LLMS });

    // Assert
    assert.equal(res.contents[0].text, llms.fallbackText);
  });
});

describe('readPublicText', () => {
  beforeEach(() => clearResourceCache());

  it('should fetch with a timeout signal and ask for text', async () => {
    // Arrange
    const fetchImpl = mock.fn(async () => textResponse('# MyMedi-AI'));

    // Act
    await readPublicText(llms, { fetchImpl });

    // Assert
    const [url, init] = fetchImpl.mock.calls[0].arguments;
    assert.equal(url, LLMS);
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers.Accept, 'text/plain');
  });

  it('should serve repeat reads from a one-hour cache', async () => {
    // Arrange
    const fetchImpl = mock.fn(async () => textResponse('cached body'));
    const now = 1_000_000;
    await readPublicText(llms, { fetchImpl, now });

    // Act
    const within = await readPublicText(llms, { fetchImpl, now: now + PUBLIC_TEXT_TTL_MS - 1 });
    await readPublicText(llms, { fetchImpl, now: now + PUBLIC_TEXT_TTL_MS });

    // Assert
    assert.equal(PUBLIC_TEXT_TTL_MS, 60 * 60 * 1000);
    assert.equal(within, 'cached body');
    assert.equal(fetchImpl.mock.callCount(), 2);
  });

  for (const [label, respond] of [
    ['a 404', async () => textResponse('Not Found', 404)],
    ['a network error', async () => { throw new TypeError('fetch failed'); }],
    ['a timeout', async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); }],
    ['an HTML page (SPA fallback) instead of text', async () => textResponse('<!doctype html><html></html>', 200, 'text/html')],
  ]) {
    it(`should fall back to the static summary on ${label}, without caching the failure`, async () => {
      // Arrange
      const fetchImpl = mock.fn(respond);

      // Act
      const first = await readPublicText(llms, { fetchImpl });
      await readPublicText(llms, { fetchImpl });

      // Assert
      assert.equal(first, llms.fallbackText);
      assert.equal(fetchImpl.mock.callCount(), 2);
    });
  }
});
