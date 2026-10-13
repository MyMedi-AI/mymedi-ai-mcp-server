/**
 * When the package starts a server by itself: only when it is the program
 * Node was started with (`node src/index.js`, or the npx bin link to it) —
 * never inside another program that imports it, whatever that program's
 * entry file is called.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isMainModule } from '../src/index.js';

const ENTRY = fileURLToPath(new URL('../src/index.js', import.meta.url));
const ENTRY_URL = new URL('../src/index.js', import.meta.url).href;
const INIT = `${JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cli-test', version: '1.0.0' } },
})}\n`;

// Run a script with an initialize request on stdin; stdout shows whether an
// MCP server answered it.
const run = (script) =>
  spawnSync(process.execPath, [script], { input: INIT, encoding: 'utf8', timeout: 15000, env: { ...process.env, MCP_HTTP: '' } });

describe('isMainModule', () => {
  let dir;
  let link;
  let other;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mymedi-mcp-cli-'));
    mkdirSync(join(dir, 'bin'));
    link = join(dir, 'bin', 'mymedi-ai-mcp');
    symlinkSync(ENTRY, link);
    other = join(dir, 'index.js');
    writeFileSync(other, '');
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('should be true for the package entry itself', () => {
    assert.equal(isMainModule(ENTRY, ENTRY_URL), true);
  });

  it('should be true for a symlink to it (the npx bin link)', () => {
    assert.equal(isMainModule(link, ENTRY_URL), true);
  });

  it('should be false for another program whose entry file is also index.js', () => {
    assert.equal(isMainModule(other, ENTRY_URL), false);
  });

  it('should be false with no entry or one that does not exist', () => {
    assert.deepEqual([isMainModule(undefined, ENTRY_URL), isMainModule(join(dir, 'missing.js'), ENTRY_URL)], [false, false]);
  });
});

describe('starting a server', () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mymedi-mcp-host-'));
    writeFileSync(join(dir, 'index.js'), `import(${JSON.stringify(ENTRY_URL)}).then(() => process.stdout.write('imported\\n'));\n`);
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
    mkdirSync(join(dir, 'bin'));
    symlinkSync(ENTRY, join(dir, 'bin', 'mymedi-ai-mcp'));
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('should not start stdio inside a program named index.js that imports the package', () => {
    const { stdout } = run(join(dir, 'index.js'));
    assert.equal(stdout, 'imported\n');
  });

  it('should start stdio when run directly', () => {
    const { stdout } = run(ENTRY);
    assert.match(stdout, /"serverInfo":\{"name":"mymedi-ai"/);
  });

  it('should start stdio when run through a symlink to the entry (npx)', () => {
    const { stdout } = run(join(dir, 'bin', 'mymedi-ai-mcp'));
    assert.match(stdout, /"serverInfo":\{"name":"mymedi-ai"/);
  });
});
