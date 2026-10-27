/**
 * The tool catalog the package advertises: 32 tools, split into the six free
 * no-key lookups, the two free account tools and 24 tools billed in credits.
 * The hosted connector's copy is held to the same contract by
 * server/mcp/tools.parity.test.js in the MyMedi-AI app repo.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer, createSandboxServer } from '../src/index.js';
import { MCP_TOOLS, SERVER_INSTRUCTIONS, getToolByName } from '../src/tools.js';

const isFree = (tool) => tool.price === 'free';
const credits = (tool) => Math.round(Number(tool.price.replace('$', '')) * 1000);
const perCode = (tool) => Boolean(tool.schema.codes);
const paid = MCP_TOOLS.filter((tool) => !isFree(tool));

describe('tool catalog', () => {
  it('should register 32 tools with unique names', () => {
    // Arrange
    const names = MCP_TOOLS.map((tool) => tool.name);

    // Assert
    assert.equal(names.length, 32);
    assert.equal(new Set(names).size, names.length);
  });

  it('should have six free no-key tools, two free account tools and 24 paid tools', () => {
    // Arrange
    const freeNoKey = MCP_TOOLS.filter((tool) => isFree(tool) && tool.auth === false);
    const account = MCP_TOOLS.filter((tool) => isFree(tool) && tool.auth === true);
    const paid = MCP_TOOLS.filter((tool) => !isFree(tool));

    // Assert
    assert.deepEqual([freeNoKey.length, account.length, paid.length], [6, 2, 24]);
  });

  it('should price every paid tool as a dollar amount', () => {
    for (const tool of MCP_TOOLS.filter((t) => !isFree(t))) {
      assert.match(tool.price, /^\$\d+(\.\d+)?$/, tool.name);
    }
  });

  it('should find a tool by its name', () => {
    assert.equal(getToolByName('code_lookup')?.name, 'code_lookup');
  });

  it('should return undefined for an unknown tool', () => {
    assert.equal(getToolByName('no_such_tool'), undefined);
  });
});

describe('tool descriptions say only what the tools return', () => {
  // Licence status is not uniform (RxNorm comes under NLM's terms; the CMS
  // RVU files carry AMA-copyright CPT content), so sources are named, never
  // described as public domain.
  it('should make no public-domain or licence claim about a data source', () => {
    for (const tool of MCP_TOOLS) {
      assert.doesNotMatch(`${tool.title}\n${tool.description}`, /public domain|no licen[cs]e/i, tool.name);
    }
  });

  it('market_analysis: should describe the NPPES floor and a labelled model estimate, not density or competition metrics', () => {
    const { description } = getToolByName('market_analysis');
    assert.doesNotMatch(description, /provider density|competition|market opportunity data/i);
    assert.match(description, /at most 200 records, so the figure is a floor, not a provider count/);
    assert.match(description, /LLM-generated estimate, labelled as such/);
  });

  it('drug_enrich: should describe the label and a labelled LLM summary, with no PA likelihood, cost tier or interaction check', () => {
    const { title, description } = getToolByName('drug_enrich');
    assert.doesNotMatch(`${title}\n${description}`, /prior[- ]auth\w* likelihood|cost tier|AI analysis/i);
    assert.match(description, /LLM-generated summary, labelled as such/);
    assert.match(description, /does not check interactions between drugs/);
    assert.match(description, /A failed call \(drug not found, openFDA or the model unavailable\) is refunded/);
  });

  it('ner_extract: should describe whole ICD-10-CM, HCPCS and keyword-marked CPT codes, with no drug names or spans', () => {
    const { title, description, schema } = getToolByName('ner_extract');
    assert.doesNotMatch(`${title}\n${description}`, /medication names|span/i);
    assert.match(description, /ICD-10-CM codes whole, dotted or undotted, with their 7th-character extensions/);
    assert.match(description, /HCPCS Level II codes/);
    assert.match(description, /CPT codes only where a keyword such as CPT or procedure code marks them/);
    assert.match(description, /does not extract drug names/);
    assert.match(schema.entityTypes.description, /ICD10_CODE, HCPCS_CODE, CPT_CODE, DATE, MEDICATION_INDICATOR/);
  });

  it('pa_predict: should say the approval cohort is the caller organization\'s own decided PAs', () => {
    const { description, schema } = getToolByName('pa_predict');
    assert.match(description, /computed only from your organization's own decided prior authorizations for that code/);
    assert.match(description, /an API key or account with no organization has no cohort/);
    assert.match(schema.payerId.description, /narrows your organization's own decided-PA cohort to that payer/);
  });

  it('provider_enrich: should describe the NPPES record and a labelled model estimate, not affiliations or market context', () => {
    const { description } = getToolByName('provider_enrich');
    assert.doesNotMatch(description, /affiliations|market context|practice details/i);
    assert.match(description, /LLM-generated estimate, labelled as such/);
    assert.match(description, /never the name or NPI/);
    assert.match(description, /specialty, taxonomy, credential, state, entity type and enumeration date/);
  });
});

// The briefing is computed from the catalog, so these follow the prices.
describe('server instructions', () => {
  it('should name every free no-key tool', () => {
    for (const tool of MCP_TOOLS.filter((t) => isFree(t) && t.auth === false)) {
      assert.ok(SERVER_INSTRUCTIONS.includes(tool.name), tool.name);
    }
  });

  it('should say the two account tools are free, not paid', () => {
    assert.ok(SERVER_INSTRUCTIONS.includes('account_status and buy_credits are free account tools'));
    assert.doesNotMatch(SERVER_INSTRUCTIONS, /every other tool is paid/i);
  });

  it('should give the per-call credit range of the paid tools from their prices', () => {
    // Arrange
    const perCall = paid.filter((tool) => !perCode(tool));
    const low = Math.min(...perCall.map(credits));
    const high = Math.max(...perCall.map(credits));
    const cheapest = perCall.find((tool) => credits(tool) === low).name;
    const dearest = perCall.find((tool) => credits(tool) === high).name;

    // Assert
    assert.ok(SERVER_INSTRUCTIONS.includes(
      `The other ${paid.length} tools are paid from prepaid credits (1 credit = $0.001): from ${low} credit${low === 1 ? '' : 's'} (${cheapest}) to ${high} credits (${dearest}) per call`
    ));
  });

  it('should name every batch tool as priced per code', () => {
    const batch = paid.filter(perCode).map((tool) => tool.name);
    assert.ok(batch.length > 0);
    for (const name of batch) assert.match(SERVER_INSTRUCTIONS, new RegExp(`${name}[^.]*priced per code`));
  });

  it('should point to the _billing field instead of claiming every description gives its price', () => {
    assert.doesNotMatch(SERVER_INSTRUCTIONS, /description gives its price/);
    assert.match(SERVER_INSTRUCTIONS, /_billing field with the credits spent and the balance left/);
  });

  it('should keep the PHI-free rule and make no compliance claim or first-person voice', () => {
    assert.match(SERVER_INSTRUCTIONS, /PHI-free: never send patient names, dates of birth, Medicare Beneficiary Identifiers \(MBI\)/);
    assert.doesNotMatch(SERVER_INSTRUCTIONS, /HIPAA/i);
    assert.doesNotMatch(SERVER_INSTRUCTIONS, /\b(we|our|I|my)\b/);
  });
});

// The Connectors Directory reads annotations.title, not the top-level title.
describe('tools/list', () => {
  const servers = [
    ['server', () => createMcpServer({ apiKey: '', apiBaseUrl: 'http://api.test', connectorToken: '' })],
    ['sandbox server', createSandboxServer],
  ];

  for (const [label, create] of servers) {
    it(`should carry every tool title in its annotations (${label})`, async () => {
      // Arrange
      const server = create();
      const client = new Client({ name: 'test-client', version: '1.0.0' });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

      // Act
      const { tools } = await client.listTools();
      await client.close();
      await server.close();

      // Assert
      const mismatched = tools.filter((t) => !t.title || t.annotations?.title !== t.title).map((t) => t.name);
      assert.deepEqual(mismatched, []);
    });
  }
});
