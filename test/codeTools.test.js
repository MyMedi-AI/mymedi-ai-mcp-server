/**
 * The code tools' arguments and descriptions as the package advertises them.
 *
 * code_validate(_batch): a top-level dateOfService used to be undeclared, so
 * zod stripped it and the API judged the code as of today — and billed it.
 * It is declared now, and a malformed date is refused before any call.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { z } from 'zod';

import { getToolByName } from '../src/tools.js';

const parse = (name, args) => z.object(getToolByName(name).schema).safeParse(args);

describe('code_validate and code_validate_batch: date of service', () => {
  it('should keep a top-level dateOfService', () => {
    const result = parse('code_validate', { code: 'I42.0', dateOfService: '2026-09-30' });

    assert.deepEqual(result.data, { code: 'I42.0', dateOfService: '2026-09-30' });
  });

  it('should keep a top-level dateOfService in a batch', () => {
    const result = parse('code_validate_batch', { codes: ['I42.0', 'I42.00'], dateOfService: '2026-09-30' });

    assert.deepEqual(result.data, { codes: ['I42.0', 'I42.00'], dateOfService: '2026-09-30' });
  });

  for (const date of ['09/30/2026', '2026-9-30', '2026-09-30T00:00:00Z', '']) {
    it(`should refuse the malformed date ${JSON.stringify(date)} at the top level and in context`, () => {
      assert.equal(parse('code_validate', { code: 'I42.0', dateOfService: date }).success, false);
      assert.equal(parse('code_validate', { code: 'I42.0', context: { dateOfService: date } }).success, false);
      assert.equal(parse('code_validate_batch', { codes: ['I42.0'], dateOfService: date }).success, false);
    });
  }

  it('should keep a snake_case date_of_service, and refuse a malformed one', () => {
    assert.equal(parse('code_validate', { code: 'I42.0', date_of_service: '2026-09-30' }).data.date_of_service, '2026-09-30');
    assert.equal(parse('code_validate_batch', { codes: ['I42.0'], date_of_service: '09/30/2026' }).success, false);
  });

  it('should describe the date of service and the asOf date the result reports', () => {
    const { description } = getToolByName('code_validate');

    assert.match(description, /dateOfService is YYYY-MM-DD \(default today\)/);
    assert.match(description, /asOf in the result is the date the code was judged for/);
  });
});

describe('code_suggest: how results are ranked', () => {
  it('should say it is a term search, ranked by relevance, with weak matches left out', () => {
    const { description } = getToolByName('code_suggest');

    assert.match(description, /term search over the 90K-code CMS database, no language model/);
    assert.match(description, /relevanceScore 0-1/);
    assert.match(description, /the best code for each separate thing a description names \(a diagnosis and a device\) comes first/);
    assert.match(description, /grouped rather than strictly sorted by relevanceScore/);
    assert.match(description, /Weak matches are left out rather than listed/);
  });
});

describe('code_crossref: what the related codes are', () => {
  it('should describe the curated links and the ranked description matches', () => {
    const { description } = getToolByName('code_crossref');

    assert.match(description, /linkedCodes are curated: the DME code family/);
    assert.match(description, /links across code systems that cite their CMS source/);
    assert.match(description, /crossReferences are other active codes whose descriptions best match this one/);
    assert.match(description, /weaker matches are left out, so a group can be empty/);
    assert.match(description, /a code with no related codes at all is refunded/);
  });
});

// No NCCI procedure-to-procedure table is loaded for the API, and the MUE
// table is never consulted by the claim check (a claim carries no units).
describe('claims_validate: no NCCI claim', () => {
  const NO_NCCI = 'applies no NCCI edits — neither procedure-to-procedure (PTP) pairs nor MUE unit limits';

  it('should say it applies no NCCI PTP or MUE edits', () => {
    assert.ok(getToolByName('claims_validate').description.includes(NO_NCCI));
  });

  it('should mention NCCI, PTP or MUE only in that disclaimer', () => {
    const { title, description } = getToolByName('claims_validate');

    assert.doesNotMatch(`${title}\n${description}`.split(NO_NCCI).join(''), /NCCI|\bMUE|\bPTP\b|bundl/i);
  });
});
