/**
 * Release checks (scripts/check-release.mjs) and the publish workflow that
 * runs them at the root of the public mirror.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import { checkPackFiles, checkVersions, expectedPackFiles } from '../scripts/check-release.mjs';

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const manifests = () => ({
  pkg: readJson('../package.json'),
  lock: readJson('../package-lock.json'),
  server: readJson('../server.json'),
});
const WORKFLOW = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8');

describe('checkVersions', () => {
  it('should pass this package as it stands: every declared version agrees', () => {
    assert.deepEqual(checkVersions(manifests()), []);
  });

  it('should pass a tag that matches every declared version', () => {
    const m = manifests();
    assert.deepEqual(checkVersions(m, `v${m.pkg.version}`), []);
  });

  it('should name each file that disagrees with the tag', () => {
    // Arrange
    const m = manifests();
    m.lock.packages[''].version = '0.0.1';
    m.server.packages[0].version = '0.0.2';

    // Act
    const problems = checkVersions(m, `v${m.pkg.version}`);

    // Assert
    assert.equal(problems.length, 2);
    assert.match(problems.join('\n'), /package-lock\.json packages\[""\]\.version is 0\.0\.1/);
    assert.match(problems.join('\n'), /server\.json packages\[0\]\.version is 0\.0\.2/);
  });

  it('should refuse a tag that is not vMAJOR.MINOR.PATCH', () => {
    assert.match(checkVersions(manifests(), 'release-1').join('\n'), /not a vX\.Y\.Z tag/);
  });

  it('should refuse an mcpName that differs from server.json', () => {
    const m = manifests();
    m.pkg.mcpName = 'io.github.someone-else/mcp-server';
    assert.match(checkVersions(m).join('\n'), /mcpName/);
  });

  it('should keep the platform version in step when the app repo is present', (t) => {
    // In the MyMedi-AI app repo, server/config/platformConfig.js must name
    // the same version (its own Jest suite enforces this too); the mirror
    // has no server/ directory.
    let source;
    try {
      source = readFileSync(new URL('../../../server/config/platformConfig.js', import.meta.url), 'utf8');
    } catch {
      t.skip('outside the app repo');
      return;
    }
    const [, platformVersion] = source.match(/export const PLATFORM_VERSION = '([^']+)'/);
    assert.equal(platformVersion, manifests().pkg.version);
  });
});

describe('checkPackFiles', () => {
  const srcFiles = readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.js'));

  it('should expect package.json, README.md, LICENSE and every src module', () => {
    assert.deepEqual(expectedPackFiles(srcFiles), ['LICENSE', 'README.md', 'package.json', ...srcFiles.map((f) => `src/${f}`).sort()].sort());
  });

  it('should pass exactly the shipped files', () => {
    assert.deepEqual(checkPackFiles(expectedPackFiles(srcFiles), srcFiles), []);
  });

  it('should flag an extra file and a missing module', () => {
    const packed = [...expectedPackFiles(srcFiles).filter((f) => f !== 'src/http.js'), 'test/http.test.js'];
    const problems = checkPackFiles(packed, srcFiles).join('\n');
    assert.match(problems, /unexpected in the tarball: test\/http\.test\.js/);
    assert.match(problems, /missing from the tarball: src\/http\.js/);
  });
});

describe('publish workflow', () => {
  it('should grant nothing by default and OIDC only to the publish job', () => {
    assert.match(WORKFLOW, /^permissions: \{\}$/m);
    assert.equal((WORKFLOW.match(/id-token: write/g) ?? []).length, 1);
  });

  it('should pin every action to a full commit SHA', () => {
    const uses = [...WORKFLOW.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length >= 2);
    uses.forEach((ref) => assert.match(ref, /@[0-9a-f]{40}$/, ref));
  });

  it('should be a dry run by default when started by hand', () => {
    assert.match(WORKFLOW, /dry_run:[\s\S]*?default: true/);
  });

  it('should publish to npm with provenance from the CLI, not publishConfig', () => {
    assert.match(WORKFLOW, /npm publish --provenance --access public/);
    assert.equal(manifests().pkg.publishConfig?.provenance, undefined);
  });

  // npm and the MCP Registry are published by one job. If a registry step
  // fails after npm accepted the version, "re-run failed jobs" must not hit
  // npm's E403 (version already published) and strand the registry steps.
  it('should skip npm publish when this version is already on npm, so a re-run reaches the registry', () => {
    const step = WORKFLOW.slice(WORKFLOW.indexOf('- name: Publish to npm'), WORKFLOW.indexOf('- name: Read mcpName back'));
    assert.match(step, /published="\$\(npm view "\$\{name\}@\$\{version\}" version 2>\/dev\/null \|\| true\)"/);
    assert.match(step, /if \[ "\$published" = "\$version" \]; then[\s\S]*?else\s+npm publish --provenance --access public --ignore-scripts\s+fi/);
    // The package name and version reach the script from package.json, not
    // through ${{ }} interpolation.
    assert.doesNotMatch(step.slice(step.indexOf('run: |')), /\$\{\{/);
  });

  it('should verify the pinned mcp-publisher download by checksum', () => {
    assert.match(WORKFLOW, /MCP_PUBLISHER_SHA256: '[0-9a-f]{64}'/);
    assert.match(WORKFLOW, /sha256sum -c -/);
    assert.match(WORKFLOW, /mcp-publisher login github-oidc/);
  });

  it('should never interpolate the ref name straight into a shell script', () => {
    assert.doesNotMatch(WORKFLOW, /run:[^\n]*\$\{\{\s*github\.ref_name/);
  });
});
