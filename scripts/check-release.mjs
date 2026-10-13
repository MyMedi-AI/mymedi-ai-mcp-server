#!/usr/bin/env node
/**
 * Release checks, run by the publish workflow and by hand before tagging:
 *
 *   node scripts/check-release.mjs [--tag vX.Y.Z] [--pack]
 *
 * Always: every declared version agrees — package.json, package-lock.json
 * (root and packages[""]), server.json and its npm package entry — and
 * package.json's mcpName equals server.json's name. With --tag, they must
 * also equal the tag. With --pack, `npm pack --dry-run` must list exactly
 * the files users get: package.json, README.md, LICENSE and every src module.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = new URL('../', import.meta.url);

/**
 * @param {{ pkg: object, lock: object, server: object }} manifests
 * @param {string} [tag] - e.g. "v1.7.6"; omit to check agreement only
 * @returns {string[]} problems, empty when the release is consistent
 */
export function checkVersions({ pkg, lock, server }, tag) {
  const problems = [];
  let expected = pkg.version;
  if (tag !== undefined) {
    const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
    if (!match) return [`"${tag}" is not a vX.Y.Z tag`];
    [, expected] = match;
  }
  const npmEntries = (server.packages ?? []).filter((p) => p.registryType === 'npm' && p.identifier === pkg.name);
  const declared = [
    ['package.json version', pkg.version],
    ['package-lock.json version', lock.version],
    ['package-lock.json packages[""].version', lock.packages?.['']?.version],
    ['server.json version', server.version],
    ...npmEntries.map((p) => [`server.json packages[${server.packages.indexOf(p)}].version`, p.version]),
  ];
  if (npmEntries.length === 0) problems.push(`server.json has no npm package entry for ${pkg.name}`);
  for (const [where, version] of declared) {
    if (version !== expected) problems.push(`${where} is ${version}, expected ${expected}`);
  }
  if (pkg.mcpName !== server.name) {
    problems.push(`package.json mcpName is ${pkg.mcpName}, but server.json name is ${server.name}`);
  }
  return problems;
}

/**
 * @param {string[]} srcFiles - the .js file names in src/
 * @returns {string[]} the paths a correct tarball holds, sorted
 */
export function expectedPackFiles(srcFiles) {
  return ['package.json', 'README.md', 'LICENSE', ...srcFiles.map((f) => `src/${f}`)].sort();
}

/**
 * @param {string[]} packed - paths `npm pack --dry-run --json` lists
 * @param {string[]} srcFiles - the .js file names in src/
 * @returns {string[]} problems, empty when the tarball is exactly right
 */
export function checkPackFiles(packed, srcFiles) {
  const expected = new Set(expectedPackFiles(srcFiles));
  const actual = new Set(packed);
  return [
    ...[...actual].filter((f) => !expected.has(f)).sort().map((f) => `unexpected in the tarball: ${f}`),
    ...[...expected].filter((f) => !actual.has(f)).sort().map((f) => `missing from the tarball: ${f}`),
  ];
}

function readManifests() {
  const read = (name) => JSON.parse(readFileSync(new URL(name, PACKAGE_DIR), 'utf8'));
  return { pkg: read('package.json'), lock: read('package-lock.json'), server: read('server.json') };
}

function packedFiles() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: fileURLToPath(PACKAGE_DIR),
    encoding: 'utf8',
  });
  const [report] = JSON.parse(out);
  return report.files.map((f) => f.path);
}

function main(argv) {
  const tagIndex = argv.indexOf('--tag');
  const tag = tagIndex === -1 ? undefined : argv[tagIndex + 1] ?? '';
  const problems = checkVersions(readManifests(), tag);
  if (argv.includes('--pack')) {
    const srcFiles = readdirSync(new URL('src/', PACKAGE_DIR)).filter((f) => f.endsWith('.js'));
    problems.push(...checkPackFiles(packedFiles(), srcFiles));
  }
  if (problems.length) {
    problems.forEach((p) => console.error(`check-release: ${p}`));
    return 1;
  }
  console.log(`check-release: ok${tag ? ` for ${tag}` : ''}${argv.includes('--pack') ? ' (tarball contents checked)' : ''}`);
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
