/**
 * A paid tool answered 402: what the npm server tells the person reading the
 * chat. A keyed install is sent to buy_credits; a keyless one is told how to
 * get a key — a POST request, never a link a browser cannot open.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../src/index.js';

const API = 'http://api.test';

async function callWith402(apiKey, name, args, paymentInfo = {}) {
  mock.method(globalThis, 'fetch', async () => Response.json(paymentInfo, { status: 402 }));
  const server = createMcpServer({ apiKey, apiBaseUrl: API, connectorToken: '' });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  await server.close();
  return { result, body: JSON.parse(result.content[0].text) };
}

describe('402 without an API key', () => {
  afterEach(() => mock.restoreAll());

  it('should describe registration as a POST request with its body', async () => {
    // Act
    const { result, body } = await callWith402('', 'code_lookup', { code: 'E0601' });

    // Assert
    assert.equal(result.isError, true);
    assert.deepEqual(body.register, {
      method: 'POST',
      url: `${API}/bot-marketplace/register`,
      body: { name: 'my-agent', source: 'mcp-npm-402' },
    });
    assert.match(body.message, /sending a POST request — the URL is not a web page/);
  });

  // The register route keeps `source` (letters, digits, - and _) as the
  // signup source, so sign-ups that came from this answer can be counted.
  it('should tag the registration it suggests with source mcp-npm-402', async () => {
    const { body } = await callWith402('', 'code_lookup', { code: 'E0601' });
    assert.ok(body.message.includes(`-d '{"name":"my-agent","source":"mcp-npm-402"}'`), body.message);
  });

  it('should say which variable to set and how to top up later', async () => {
    const { body } = await callWith402('', 'code_lookup', { code: 'E0601' });
    assert.match(body.message, /Set MCP_API_KEY to the apiKey it returns/);
    assert.match(body.message, /buy_credits/);
  });

  it('should not call the JSON pricing table a Stripe page', async () => {
    const { body } = await callWith402('', 'code_lookup', { code: 'E0601' });
    assert.doesNotMatch(JSON.stringify(body), /credits\/pricing|Stripe at/);
  });

  it('should price a batch tool per code, not per call', async () => {
    const { body } = await callWith402('', 'code_lookup_batch', { codes: ['E0601'] });
    assert.match(body.message, /\(\$0\.001 per code\)/);
  });
});

describe('402 with an API key', () => {
  afterEach(() => mock.restoreAll());

  it('should name buy_credits as the next step with the balance and shortfall', async () => {
    // Act
    const { body } = await callWith402('mmai-test-key', 'pa_predict', { procedureCode: 'E0601' }, {
      creditInfo: { creditBalance: 20 },
      pricing: { creditsRequired: 50 },
    });

    // Assert
    assert.equal(body.nextStep.tool, 'buy_credits');
    assert.equal(body.shortfallCredits, 30);
    assert.match(body.message, /^Out of credits — pa_predict costs 50 credits; the balance is 20 credits\. Call buy_credits/);
  });

  // The REST gate answers a mistyped, incomplete or revoked key with a 402
  // whose creditInfo carries creditError "Invalid API key" and no balance.
  // "Out of credits — call buy_credits" would send the caller to a tool
  // that refuses the same key.
  it('should say the key was not recognised, not that credits ran out', async () => {
    // Act
    const { result, body } = await callWith402('mmai-mistyped', 'code_lookup', { code: 'E0601' }, {
      creditInfo: { creditError: 'Invalid API key' },
    });

    // Assert
    assert.equal(result.isError, true);
    assert.equal(body.error, 'invalid_api_key');
    assert.match(body.message, /API key this server sends was not recognised/);
    assert.match(body.message, /Check MCP_API_KEY \(or the MYMEDI_API_KEY alias\)/);
    assert.doesNotMatch(body.message, /Out of credits|buy_credits/);
    assert.equal(body.nextStep, undefined);
  });

  it('should offer registration (a POST) when the key was not recognised', async () => {
    const { body } = await callWith402('mmai-mistyped', 'code_lookup', { code: 'E0601' }, {
      creditInfo: { creditError: 'Invalid API key' },
    });
    assert.equal(body.register.method, 'POST');
    assert.equal(body.register.url, `${API}/bot-marketplace/register`);
  });

  it('should not send a keyed install to the web credits page, which tops up a different account', async () => {
    const { body } = await callWith402('mmai-test-key', 'code_lookup', { code: 'E0601' });
    assert.doesNotMatch(JSON.stringify(body), /account\/credits|register/);
  });
});
