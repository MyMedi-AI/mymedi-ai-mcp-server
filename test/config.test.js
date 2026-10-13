/**
 * Environment settings: the API key (MCP_API_KEY, or the MYMEDI_API_KEY alias
 * the registration response prints), the API base URL and the connector token.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveApiBaseUrl, resolveApiKey, resolveConnectorToken } from '../src/config.js';

describe('resolveApiKey', () => {
  it('should read MCP_API_KEY', () => {
    assert.equal(resolveApiKey({ MCP_API_KEY: 'mmai-a' }), 'mmai-a');
  });

  it('should accept MYMEDI_API_KEY as an alias', () => {
    assert.equal(resolveApiKey({ MYMEDI_API_KEY: 'mmai-b' }), 'mmai-b');
  });

  it('should prefer MCP_API_KEY when both are set', () => {
    assert.equal(resolveApiKey({ MCP_API_KEY: 'mmai-a', MYMEDI_API_KEY: 'mmai-b' }), 'mmai-a');
  });

  it('should treat a blank MCP_API_KEY as unset', () => {
    assert.equal(resolveApiKey({ MCP_API_KEY: '  ', MYMEDI_API_KEY: 'mmai-b' }), 'mmai-b');
  });

  it('should trim a pasted key', () => {
    assert.equal(resolveApiKey({ MCP_API_KEY: ' mmai-a\n' }), 'mmai-a');
  });

  it('should return an empty string when no key is set', () => {
    assert.equal(resolveApiKey({}), '');
  });
});

describe('resolveApiBaseUrl', () => {
  it('should default to https://mymedi-ai.com', () => {
    assert.equal(resolveApiBaseUrl({}), 'https://mymedi-ai.com');
  });

  it('should drop a trailing slash so paths do not double it', () => {
    assert.equal(resolveApiBaseUrl({ MCP_API_BASE_URL: 'http://localhost:3000/' }), 'http://localhost:3000');
  });
});

describe('resolveConnectorToken', () => {
  it('should read MCP_CONNECTOR_TOKEN, blank when unset', () => {
    assert.deepEqual([resolveConnectorToken({ MCP_CONNECTOR_TOKEN: 't0k' }), resolveConnectorToken({})], ['t0k', '']);
  });
});
