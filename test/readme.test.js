/**
 * The README is the package's storefront on npm, GitHub, Glama and Smithery.
 * Its numbers come from the code: tool count, names and prices from
 * MCP_TOOLS, prompt arguments from MCP_PROMPTS, the code count from the
 * code_suggest description, and every environment variable the source reads
 * must be documented. Claims the product cannot make are refused outright.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import { MCP_PROMPTS } from '../src/prompts.js';
import { MCP_TOOLS, getToolByName } from '../src/tools.js';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const SRC_DIR = new URL('../src/', import.meta.url);

const section = (heading) => {
  const start = README.indexOf(`\n${heading}`);
  assert.notEqual(start, -1, `README has no "${heading}" section`);
  const next = README.indexOf('\n## ', start + heading.length + 1);
  return README.slice(start, next === -1 ? undefined : next);
};
const tableRows = (text) => text.split('\n').filter((line) => /^\| `[^`]+` \|/.test(line));
const cells = (row) => row.split('|').slice(1, -1).map((cell) => cell.trim());

const isPerCode = (tool) => Boolean(tool.schema.codes);
const priceLabel = (tool) => (tool.price === 'free' ? 'free' : `${tool.price}${isPerCode(tool) ? '/code' : ''}`);
const credits = (tool) => Math.round(Number(tool.price.replace('$', '')) * 1000);

describe('README: the tool catalog comes from MCP_TOOLS', () => {
  const toolsSection = section(`## Tools (${MCP_TOOLS.length})`);
  const rows = tableRows(toolsSection);

  it('should state the tool count in the heading and the introduction', () => {
    assert.match(README, new RegExp(`\\*\\*${MCP_TOOLS.length} tools\\*\\*`));
  });

  it('should list every tool once, and nothing else', () => {
    const listed = rows.map((row) => cells(row)[0].replace(/`/g, ''));
    assert.deepEqual([...listed].sort(), MCP_TOOLS.map((t) => t.name).sort());
  });

  for (const tool of MCP_TOOLS) {
    it(`should price ${tool.name} at ${priceLabel(tool)}`, () => {
      const row = rows.find((r) => cells(r)[0] === `\`${tool.name}\``);
      assert.equal(cells(row).at(-1), priceLabel(tool));
    });
  }

  it('should give the per-call credit range computed from the prices', () => {
    const perCall = MCP_TOOLS.filter((t) => t.price !== 'free' && !isPerCode(t));
    const low = Math.min(...perCall.map(credits));
    const high = Math.max(...perCall.map(credits));
    const cheapest = perCall.find((t) => credits(t) === low).name;
    const dearest = perCall.find((t) => credits(t) === high).name;
    assert.ok(README.includes(`from ${low} credit${low === 1 ? '' : 's'} (\`${cheapest}\`) to ${high} credits (\`${dearest}\`) per call`));
  });

  it('should name the six free no-key tools in the free-tools table', () => {
    const free = tableRows(section('## Free tools (no API key)')).map((row) => cells(row)[0].replace(/`/g, ''));
    assert.deepEqual(free.sort(), MCP_TOOLS.filter((t) => t.price === 'free' && t.auth === false).map((t) => t.name).sort());
  });

  it('should quote the code count the tools themselves state', () => {
    const [, stated] = getToolByName('code_suggest').description.match(/(\d+)K-code/);
    const claims = [...README.matchAll(/(\d+)K\+/g)].map((m) => m[1]);
    assert.ok(claims.length > 0);
    claims.forEach((claim) => assert.equal(claim, stated));
  });
});

describe('README: prompts come from MCP_PROMPTS', () => {
  const rows = tableRows(section('## Prompts'));

  for (const prompt of MCP_PROMPTS) {
    it(`should list ${prompt.name} with its arguments`, () => {
      const row = rows.find((r) => cells(r)[0] === `\`${prompt.name}\``);
      assert.ok(row, prompt.name);
      for (const [name, schema] of Object.entries(prompt.argsSchema)) {
        assert.ok(cells(row)[1].includes(`\`${name}${schema.isOptional() ? '?' : ''}\``), `${prompt.name}: ${name}`);
      }
    });
  }
});

describe('README: every environment variable the source reads is documented', () => {
  const source = readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).map((f) => readFileSync(new URL(f, SRC_DIR), 'utf8')).join('\n');
  const names = [...new Set([...source.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]))];
  const documented = tableRows(section('## Environment variables')).map((row) => cells(row)[0].replace(/`/g, ''));

  it('should find the variables in the source', () => {
    assert.ok(names.includes('MCP_API_KEY') && names.includes('MCP_HTTP_TOKEN'), names.join(', '));
  });

  for (const name of names) {
    it(`should document ${name}`, () => {
      assert.ok(documented.includes(name), name);
    });
  }
});

describe('README: claims the product does not make', () => {
  for (const [label, pattern] of [
    ['a HIPAA compliance claim', /HIPAA[- ]?(compliant|compliance|ready|audit)/i],
    ['"no authentication" (the hosted connector is OAuth-protected)', /no authentication/i],
    ['"tools work immediately" (the connector needs a sign-in)', /tools work immediately/i],
    ['a crypto / USDC / x402 payment rail', /USDC|x402|crypto/i],
    ['"everything is read-only" (buy_credits opens a checkout)', /everything is read-only|all (the )?tools are read-only/i],
    ['CPT as public domain (it is AMA copyright)', /CPT[^.\n]*public domain|public domain[^.\n]*CPT/i],
    ['"no account needed" for the OAuth connector', /no account needed/i],
    ['the JSON price list as a Stripe or top-up page', /(Stripe|top[- ]?up)[\s\S]{0,80}credits\/pricing|credits\/pricing[\s\S]{0,80}(Stripe|top[- ]?up)/i],
    ['a browsable link to the POST-only register endpoint', /\]\(https:\/\/mymedi-ai\.com\/bot-marketplace\/register\)/],
    ['a stale code count', /81K|81,769/],
    ['a dated data release', /\b(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|June?|July?|Aug(ust)?|Sep(tember)?|Oct(ober)?|Nov(ember)?|Dec(ember)?) 20\d\d\b/],
    ['credit headers an MCP client never sees', /## Credit Balance Headers/],
    ['interaction checks in drug_rxnorm', /drug_rxnorm[^\n]*interaction/i],
  ]) {
    it(`should not contain ${label}`, () => {
      assert.doesNotMatch(README, pattern);
    });
  }

  // Any mention of HIPAA or a BAA must be a disclaimer ("no HIPAA ...",
  // "signs no BAA"): the product is PHI-free and signs no BAA, so "HIPAA-safe",
  // "HIPAA-friendly" or "BAA available" are claims it cannot make.
  const withoutDisclaimers = (text, term) =>
    text.replace(new RegExp(`\\b(?:not|no|never|without|makes no|signs no)\\b[^.\\n]{0,60}\\b${term}\\b[^.\\n]*`, 'gi'), '');

  it('should mention HIPAA only to disclaim it', () => {
    assert.doesNotMatch(withoutDisclaimers(README, 'HIPAA'), /HIPAA/i);
  });

  it('should mention a BAA only to disclaim it', () => {
    assert.doesNotMatch(withoutDisclaimers(README, 'BAA'), /\bBAA\b/);
  });

  // Public copy speaks about the product, never as a person: no first-person
  // voice outside code, where "my-agent" is an example value.
  it('should use no first-person voice outside code', () => {
    const prose = README.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    assert.doesNotMatch(prose, /\b(?:we|We|our|Our|us|Us|my|My)\b|\bI\b/);
  });

  // No personal name, handle or private address. The names are compared as
  // SHA-256 digests so this public test does not spell what it guards against.
  it('should name no person', () => {
    const PERSONAL = new Set([
      '4c0456c69d255b29719c03eb3b0f64b2d291f2107c4d53b0536ed204ae2c1251',
      '2be4e33aa3e21f6ff7ad144f8fd58228a1cce3b50340b4805ff0c63480eec488',
      'af46328899f1fe59299389add8340d77712f5bac2e1d5c75023d758113f012fa',
      'ad5dca559474ea0deef128c87b1172d847ea94ab3b5fbfee75dc61a780ee3245',
    ]);
    const words = README.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const named = words.filter((word) => PERSONAL.has(createHash('sha256').update(word).digest('hex')));
    assert.deepEqual(named, []);
    const emails = README.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
    emails.forEach((email) => assert.match(email, /@mymedi-ai\.com$/, email));
    assert.doesNotMatch(README, /\b(?:author|maintainer|written by|created by)\b\s*:/i);
    assert.doesNotMatch(README, /linkedin\.com\/in\/|(?:twitter|x)\.com\/\w/i);
  });

  it('should describe the _billing field paid results carry', () => {
    assert.match(README, /`_billing`/);
  });

  it('should document the --http mode and its token', () => {
    assert.match(README, /--http/);
    assert.match(README, /MCP_HTTP_TOKEN/);
  });

  // With MCP_HOST=0.0.0.0 the server has no name of its own: a client that
  // reaches it by LAN or Docker-host IP sends that IP as Host, and gets 403
  // unless it is listed.
  it('should say which addresses go in MCP_ALLOWED_HOSTS when listening on 0.0.0.0', () => {
    assert.match(README, /MCP_HOST=0\.0\.0\.0[^\n]*LAN[^\n]*Docker[^\n]*MCP_ALLOWED_HOSTS/);
  });

  it('should note that CPT is AMA copyright', () => {
    assert.match(README, /CPT® is a registered trademark of the American Medical Association/);
  });
});
