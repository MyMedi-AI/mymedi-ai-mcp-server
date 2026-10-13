/**
 * package.json as npm, the MCP Registry and the directories show it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { MCP_TOOLS } from '../src/tools.js';

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const pkg = readJson('../package.json');

describe('package.json description and keywords', () => {
  it('should fit in what npm shows (at most 200 characters)', () => {
    assert.ok(pkg.description.length <= 200, `${pkg.description.length} characters`);
  });

  it('should describe DME billing with the tool count from the catalog', () => {
    const free = MCP_TOOLS.filter((t) => t.price === 'free' && t.auth === false).length;
    assert.match(pkg.description, /DME billing/);
    assert.ok(pkg.description.includes(`${MCP_TOOLS.length} tools, ${free} free`), pkg.description);
  });

  it('should make no compliance or crypto-payment claim', () => {
    assert.doesNotMatch(pkg.description, /HIPAA|USDC|x402|crypto/i);
  });

  it('should keep the no-op build script Smithery runs, and npm test', () => {
    assert.match(pkg.scripts.build, /^echo /);
    assert.equal(pkg.scripts.test, 'node --test');
  });

  // The SDK's dependency tree resolves @hono/node-server 2.x, which requires
  // Node 20, and index.js loads it for the HTTP mode at startup; Node 18 is
  // past end of life.
  it('should require Node.js 20 or later, in package.json, the lockfile and the README', () => {
    const lock = readJson('../package-lock.json');
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    assert.equal(pkg.engines.node, '>=20');
    assert.equal(lock.packages[''].engines.node, pkg.engines.node);
    assert.match(readme, /Requires Node\.js 20 or later/);
  });

  it('should carry the DME and Medicare keywords and drop the retired ones', () => {
    for (const keyword of ['mcp', 'mcp-server', 'dme', 'dmepos', 'medicare', 'prior-authorization', 'medical-billing', 'hcpcs']) {
      assert.ok(pkg.keywords.includes(keyword), keyword);
    }
    for (const keyword of ['hipaa', 'x402']) {
      assert.ok(!pkg.keywords.includes(keyword), keyword);
    }
  });
});

// The MCP Registry entry. The registry checks that the npm tarball's
// package.json carries mcpName equal to server.json's name — and the name
// is baked into the tarball, so a wrong value costs a release.
describe('server.json and mcpName (MCP Registry)', () => {
  const NAME = 'io.github.MyMedi-AI/mcp-server';
  const server = readJson('../server.json');
  const repoUrl = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');

  it('should use the registry name under the MyMedi-AI GitHub namespace, in both files', () => {
    assert.deepEqual([server.name, pkg.mcpName], [NAME, NAME]);
  });

  it('should declare a dated server.json schema', () => {
    assert.match(server.$schema, /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/);
  });

  it('should keep the description within the registry limit and free of retired claims', () => {
    assert.ok(server.description.length <= 100, `${server.description.length} characters`);
    assert.doesNotMatch(server.description, /HIPAA|USDC|x402|crypto/i);
  });

  it('should point at the public mirror repository', () => {
    assert.deepEqual(server.repository, { url: repoUrl, source: 'github' });
    assert.equal(repoUrl, 'https://github.com/MyMedi-AI/mymedi-ai-mcp-server');
  });

  it('should describe exactly this npm package at this version, over stdio', () => {
    assert.equal(server.version, pkg.version);
    assert.equal(server.packages.length, 1);
    const [npmPackage] = server.packages;
    assert.deepEqual(
      { registryType: npmPackage.registryType, registryBaseUrl: npmPackage.registryBaseUrl, identifier: npmPackage.identifier, version: npmPackage.version, transport: npmPackage.transport },
      { registryType: 'npm', registryBaseUrl: 'https://registry.npmjs.org', identifier: pkg.name, version: pkg.version, transport: { type: 'stdio' } }
    );
  });

  it('should offer MCP_API_KEY as an optional secret', () => {
    const key = server.packages[0].environmentVariables.find((v) => v.name === 'MCP_API_KEY');
    assert.equal(key.isSecret, true);
    assert.equal(key.isRequired, false);
  });

  it('should list the hosted connector as a streamable-http remote', () => {
    assert.deepEqual(server.remotes, [{ type: 'streamable-http', url: 'https://mymedi-ai.com/mcp-stream' }]);
  });
});

// The public mirror is a copy of this directory. Its old .gitignore dropped
// package-lock.json, which the publish workflow's `npm ci` installs from.
describe('mirror files', () => {
  it('should track the lockfile the publish workflow installs from', () => {
    const ignored = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').split('\n').map((line) => line.trim());
    assert.ok(ignored.includes('node_modules/'));
    assert.ok(!ignored.some((line) => /package-lock\.json/.test(line)));
  });

  it('should carry the Glama maintainer file', () => {
    assert.deepEqual(readJson('../glama.json').maintainers, ['OFODevelopment']);
  });
});
