/**
 * MCP Tool Definitions for MyMedi-AI Healthcare Agent API
 * 32 tools: 6 free no-auth + 24 paid + 2 free account tools mapped
 * to MCP tool format. Uses Zod schemas (required by @modelcontextprotocol/sdk >=1.28).
 *
 * Mirrors server/mcp/tools.js (the hosted connector); that repo's
 * tools.parity.test.js holds the two copies to one contract.
 */
import { z } from 'zod';

// Annotations. Lookups are read-only: they change nothing the caller owns
// (buy_credits is the exception: it creates a Stripe checkout session).
// A free lookup is idempotent; a paid one is not — every call debits prepaid
// credits. openWorldHint is true only for tools that reach an external
// public API (openFDA, NPPES, ClinicalTrials.gov, RxNav, Open Payments, CDC)
// or an LLM; the rest answer from MyMedi-AI's own database or static data.
const FREE_LOOKUP = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const PAID_LOOKUP = { ...FREE_LOOKUP, idempotentHint: false };
const PAID_OPEN_WORLD = { ...PAID_LOOKUP, openWorldHint: true };

// Instruction text helpers: tool names and credit figures in the briefing are
// read from MCP_TOOLS, so a price or catalog change cannot leave it stale.
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const countWord = (n) => COUNT_WORDS[n] ?? String(n);
const listNames = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const creditsPerCall = (tool) => Math.round(Number(tool.price.replace('$', '')) * 1000); // 1 credit = $0.001

function buildServerInstructions(tools, { isPerCode }) {
  const free = tools.filter((t) => t.price === 'free' && !t.auth).map((t) => t.name);
  const paid = tools.filter((t) => t.price !== 'free');
  const perCall = paid.filter((t) => !isPerCode(t));
  const low = Math.min(...perCall.map(creditsPerCall));
  const high = Math.max(...perCall.map(creditsPerCall));
  const cheapest = perCall.find((t) => creditsPerCall(t) === low).name;
  const dearest = perCall.find((t) => creditsPerCall(t) === high).name;
  const batch = paid.filter(isPerCode).map((t) => t.name);
  return [
    'MyMedi-AI: DME billing intelligence and medical-coding tools built on public CMS data.',
    'PHI-free: never send patient names, dates of birth, Medicare Beneficiary Identifiers (MBI), member or record numbers, addresses or any other patient identifier in a tool call. Codes, modifiers, dates of service and de-identified text are all the tools need.',
    `Start with the ${countWord(free.length)} free tools, which never bill: ${listNames(free)}.`,
    'account_status and buy_credits are free account tools: account_status shows the credit balance, and buy_credits returns a Stripe checkout link for topping up; calling it charges nothing until checkout is completed in the browser.',
    `The other ${paid.length} tools are paid from prepaid credits (1 credit = $0.001): from ${low} credit${low === 1 ? '' : 's'} (${cheapest}) to ${high} credits (${dearest}) per call, and ${listNames(batch)} ${batch.length === 1 ? 'is' : 'are'} priced per code. Each successful paid call returns a _billing field with the credits spent and the balance left.`,
  ].join('\n\n');
}

// Input caps, shared with the REST API (it enforces the same numbers). A
// string without a specific cap is limited to MAX_TEXT. zod rejects anything
// past them before a call is sent, so nothing is billed.
const MAX_TEXT = 500;
const MAX_CLAIM_CODE = 10; // each code / modifier on a claim; dateOfService (YYYY-MM-DD)
const MAX_CLINICAL_TEXT = 20000; // ner_extract text; compliance_audit payload
const MAX_CODE_DESCRIPTION = 2000; // code_suggest
const MAX_TRIALS_QUERY = 200; // trials_search query fields
const MAX_NAME = 100; // provider_search names; market_analysis specialty
const MAX_RESULTS = 50;

// 50 states, DC and the five inhabited territories (NPPES jurisdictions).
const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP',
];

const text = () => z.string().max(MAX_TEXT);

// Enum arguments match in any letter case ("ICD10" for "icd10", "tx" for
// "TX"); the value becomes the declared member, so the API always receives
// its own spelling. The preprocess step leaves the published JSON Schema a
// plain enum. Same rule as the hosted connector.
const anyCaseEnum = (values) => z.preprocess(
  (v) => (typeof v === 'string' ? values.find((m) => m.toLowerCase() === v.toLowerCase()) ?? v : v),
  z.enum(values),
);

// Shared by the date- and state-aware PA tools: the CMS lists change on
// their effective dates, and some items are phased in state by state.
const MAX_DATE = 10; // YYYY-MM-DD
const dateOfService = () => z.string().max(MAX_DATE).optional().describe('Date of service, YYYY-MM-DD (default today)');
const phasedState = () => anyCaseEnum(US_STATE_CODES).optional().describe('2-letter US state or territory; needed for items phased in by state');

export const MCP_TOOLS = [
  // --- Free, no API key (GET endpoints, rate-limited 60/hr/IP server-side) ---
  {
    name: 'pa_required_check',
    title: 'Medicare DMEPOS prior-auth required check (free)',
    description: 'Check whether a HCPCS code is on the current CMS Required Prior Authorization List (42 CFR 414.234) on a date of service (default today). Returns paRequired flag, category, nationwide-since date, and list version. Some items are phased in by state: for those, paRequired is null until a state is given. Original Medicare FFS scope. Free, no API key required.',
    price: 'free',
    auth: false,
    method: 'GET',
    endpoint: '/agent/v1/codes/pa-required',
    annotations: FREE_LOOKUP,
    schema: {
      code: text().describe('HCPCS Level II code (e.g., "E0651")'),
      dateOfService: dateOfService(),
      state: phasedState(),
    },
  },
  {
    name: 'denial_code_info',
    title: 'DME denial code explainer (free)',
    description: 'Explain a DME claim denial code (CARC). Returns title, meaning, common DME causes, fixes, appealability, and related codes. Free, no API key required.',
    price: 'free',
    auth: false,
    method: 'GET',
    endpoint: '/agent/v1/denial',
    pathParam: 'code',
    annotations: FREE_LOOKUP,
    schema: {
      code: text().describe('CARC denial code (e.g., "CO-50", "PR-1", "197")'),
    },
  },
  {
    name: 'code_lookup_basic',
    title: 'Basic medical code lookup (free)',
    description: 'Look up basic metadata for a medical code: code, codeType, description, category, isActive. Basic metadata only — the paid code_lookup adds full metadata. Free, no API key required.',
    price: 'free',
    auth: false,
    method: 'GET',
    endpoint: '/agent/v1/demo',
    annotations: FREE_LOOKUP,
    schema: {
      code: text().describe('Medical code to look up (e.g., "M79.3")'),
    },
  },
  {
    name: 'reimbursement_basic',
    title: 'Medicare national payment rate (free)',
    description: 'Look up Medicare payment for a code. Returns the national facility and non-facility payment under the current Medicare PFS (CMS RVU × conversion factor) for professional services, plus ranges from the current CMS DMEPOS fee schedule quarter (rental/purchase, min–max across state fees) for DME items like E/K/L codes. Free, no API key required.',
    price: 'free',
    auth: false,
    method: 'GET',
    endpoint: '/agent/v1/codes/reimbursement-basic',
    annotations: FREE_LOOKUP,
    schema: {
      code: text().describe('Medical code (e.g., "97110" or "E1390")'),
    },
  },
  {
    name: 'order_readiness_checklist',
    title: 'DMEPOS order-readiness checklist (free)',
    description: 'Blank pre-delivery checklist for a HCPCS DMEPOS code: the universal standard written order (SWO) elements (42 CFR 410.38(d)), whether the code is on the current CMS Required Face-to-Face Encounter & Written Order Prior to Delivery List (F2F/WOPD), and whether it is on the current CMS Required Prior Authorization List, on a date of service (default today). Some items are phased in by state: for those, paRequired is null until a state is given. Requirement definitions only — PHI-free, never send patient data. Free, no API key required.',
    price: 'free',
    auth: false,
    method: 'GET',
    endpoint: '/agent/v1/codes/order-readiness',
    annotations: FREE_LOOKUP,
    schema: {
      code: text().describe('HCPCS Level II code (e.g., "E0466")'),
      dateOfService: dateOfService(),
      state: phasedState(),
    },
  },
  {
    name: 'modifier_advisor',
    title: 'DMEPOS billing-modifier advisor (free)',
    description: 'Editorial guidance on DMEPOS billing modifiers: the KX/GA/GY/GZ medical-necessity and liability family, RR/NU/UE rental-vs-purchase, capped-rental month markers (KH/KI/KJ), and RT/LT laterality. Pass a HCPCS code to scope guidance to that item\'s DMEPOS category, or a category directly; add a scenario phrase (e.g., "ABN on file", "bilateral") to surface the relevant modifiers. Original editorial content, not payer policy. PHI-free. Free, no API key required.',
    price: 'free',
    auth: false,
    method: 'GET',
    endpoint: '/agent/v1/modifiers',
    annotations: FREE_LOOKUP,
    schema: {
      code: text().optional().describe('HCPCS DMEPOS code to scope guidance to (e.g., "E0601")'),
      category: text().optional().describe('DMEPOS category instead of a code (e.g., "oxygen", "capped-rental", "prosthetics")'),
      scenario: text().optional().describe('Optional situation phrase (e.g., "ABN on file", "bilateral AFO", "converting rental to purchase")'),
    },
  },

  // --- Medical Coding ---
  {
    name: 'code_lookup',
    title: 'Medical code lookup (ICD-10 / CPT / HCPCS)',
    description: 'Look up a medical code (ICD-10, CPT, HCPCS). Returns description, category, active status, and related codes. For DMEPOS (HCPCS) codes it also returns a labeled fee schedule: per-modifier (RR/NU/UE) national min–max ranges, or — when a state is given — that state\'s exact non-rural and rural rates. Source: the current CMS DMEPOS fee schedule quarter.',
    price: '$0.001',
    endpoint: '/agent/v1/codes/lookup',
    annotations: PAID_LOOKUP,
    schema: {
      code: text().describe('Medical code to look up (e.g., "M79.3", "99213", "E0601")'),
      codeType: anyCaseEnum(['icd10', 'cpt', 'hcpcs']).optional().describe('Code system (auto-detected if omitted)'),
      state: text().optional().describe('2-letter US jurisdiction (50 states + DC/PR/VI). For DMEPOS codes, returns that state\'s exact non-rural/rural fees instead of only the national range.'),
    },
  },
  {
    name: 'code_lookup_batch',
    title: 'Batch medical code lookup (up to 25 codes)',
    description: 'Look up a list of medical codes (ICD-10, CPT, HCPCS) in one call. Per-item results mirror code_lookup (description, category, active status, related codes, DMEPOS fee schedule with optional state filter). Priced per code — $0.001 × number of codes, max 25 per call; the full charge is refunded automatically when every code misses.',
    price: '$0.001',
    endpoint: '/agent/v1/codes/lookup-batch',
    annotations: PAID_LOOKUP,
    schema: {
      codes: z.array(text()).min(1).max(25).describe('Medical codes to look up, e.g. ["E0601", "A7030", "M79.3"] (1-25 per call)'),
      codeType: anyCaseEnum(['icd10', 'cpt', 'hcpcs']).optional().describe('Code system applied to every code (auto-detected if omitted)'),
      state: text().optional().describe('2-letter US jurisdiction (50 states + DC/PR/VI). For DMEPOS codes, returns that state\'s exact non-rural/rural fees instead of only the national range.'),
    },
  },
  {
    name: 'code_suggest',
    title: 'Medical code suggestions from clinical text',
    description: 'Suggest ICD-10/CPT/HCPCS codes from a clinical description. Term-based search over the 90K-code CMS database, ranked by matched-term coverage and relevance. Works with natural sentences ("patient with obstructive sleep apnea prescribed CPAP"). Automatically refunds the call when nothing matches.',
    price: '$0.01',
    endpoint: '/agent/v1/codes/suggest',
    annotations: PAID_LOOKUP,
    schema: {
      description: z.string().max(MAX_CODE_DESCRIPTION).describe('Clinical description to find codes for (e.g., "chronic lower back pain")'),
      codeType: anyCaseEnum(['icd10', 'cpt', 'hcpcs']).optional().describe('Limit to specific code system'),
      limit: z.number().min(1).max(MAX_RESULTS).optional().describe('Max suggestions to return (default 10, max 50)'),
    },
  },
  {
    name: 'code_validate',
    title: 'Medical code validation',
    description: 'Validate a medical code for correctness, active status, and context. Returns warnings and errors.',
    price: '$0.005',
    endpoint: '/agent/v1/codes/validate',
    annotations: PAID_LOOKUP,
    schema: {
      code: text().describe('Medical code to validate'),
      codeType: anyCaseEnum(['icd10', 'cpt', 'hcpcs']).optional(),
      context: z.object({
        dateOfService: text().optional().describe('Date of service (YYYY-MM-DD) for temporal validation'),
      }).optional(),
    },
  },

  {
    name: 'code_validate_batch',
    title: 'Batch medical code validation (up to 25 codes)',
    description: 'Validate a list of medical codes for correctness, active status, and optional date-of-service context in one call. Per-item results mirror code_validate (valid, active, warnings, errors, codeDetails). Priced per code — $0.005 × number of codes, max 25 per call. An invalid code is a billable answer (valid:false), same as the single validate.',
    price: '$0.005',
    endpoint: '/agent/v1/codes/validate-batch',
    annotations: PAID_LOOKUP,
    schema: {
      codes: z.array(text()).min(1).max(25).describe('Medical codes to validate (1-25 per call)'),
      codeType: anyCaseEnum(['icd10', 'cpt', 'hcpcs']).optional().describe('Code system applied to every code'),
      context: z.object({
        dateOfService: text().optional().describe('Date of service (YYYY-MM-DD) for temporal validation, applied to every code'),
      }).optional(),
    },
  },

  // --- Prior Authorization ---
  {
    name: 'pa_predict',
    title: 'Prior-auth approval rate + CMS requirement facts',
    description: 'Prior-authorization outlook for a procedure code. When a historical cohort of decided PAs exists (≥10), returns a data-driven approval rate with cohort size and confidence. When no cohort exists, returns the verifiable facts instead — CMS Required Prior Authorization List status, category, and published review timeframes — and explicitly reports that no probability was computed (the call is refunded on this path). Never fabricates a probability. Original Medicare FFS scope.',
    price: '$0.05',
    endpoint: '/agent/v1/pa/predict',
    annotations: PAID_LOOKUP,
    schema: {
      procedureCode: text().describe('CPT/HCPCS procedure code (e.g., "E0651", "K0800")'),
      payerId: text().optional().describe('Insurance payer ID — narrows the approval-rate cohort to that payer when historical data exists'),
    },
  },
  {
    name: 'pa_status',
    title: 'Prior authorization status check',
    description: 'Check the status of a prior authorization request tracked in your MyMedi-AI web workspace (by its MyMedi-AI PA id). Returns current status, dates, and expiration info. It does not query payers, and returns not-found (refunded) if the PA was never entered in the web app — for a code\'s PA requirement use the free pa_required_check.',
    price: '$0.02',
    endpoint: '/agent/v1/pa/status',
    annotations: PAID_LOOKUP,
    schema: {
      authorizationId: text().optional().describe('Prior authorization ID'),
      trackingNumber: text().optional().describe('Tracking number (alternative to authorizationId)'),
    },
  },
  {
    name: 'pa_exposure_report',
    title: 'PA/WOPD catalog exposure report (up to 100 codes)',
    description: 'Map a supplier HCPCS catalog against the current CMS Required Prior Authorization List and Required Face-to-Face Encounter & Written Order Prior to Delivery List on a date of service (default today). Per code: PA requirement and the date it applies from, F2F/WOPD requirement, documentation gates (SWO, UTN-before-claim, F2F/WOPD sequencing), and deterministic denial-risk flags — plus a catalog-level exposure summary. Some items are phased in by state: pass a state for a definitive answer; without one they are reported as required in some states (paRequiredInSomeStates). Unknown or non-HCPCS codes are flagged and count as billable answers. Priced per code — $0.01 × number of codes, max 100 per call. Returns JSON. Original Medicare FFS scope. PHI-free: codes in, rules out.',
    price: '$0.01',
    endpoint: '/agent/v1/pa/exposure-report',
    annotations: PAID_LOOKUP,
    // JSON only: `format` is not declared, so zod strips it from every call.
    schema: {
      codes: z.array(text()).min(1).max(100).describe('Supplier catalog HCPCS codes, e.g. ["E0651", "L0651", "K0856"] (1-100 per call)'),
      dateOfService: dateOfService(),
      state: phasedState(),
    },
  },

  // --- NLP ---
  {
    name: 'ner_extract',
    title: 'Medical named-entity extraction from clinical text',
    description: 'Extract medical codes and clinical terms already present in free text: ICD-10, CPT and HCPCS codes, dates, and medication names, each with a span and a pattern-based confidence. Deterministic pattern extraction — it does not infer or suggest codes (use code_suggest for that). PHI-free: send de-identified text only.',
    price: '$0.02',
    endpoint: '/agent/v1/ner/extract',
    annotations: PAID_LOOKUP,
    schema: {
      text: z.string().max(MAX_CLINICAL_TEXT).describe('Clinical text to extract entities from'),
      entityTypes: z.array(z.string().max(30)).max(10).optional().describe('Filter to specific entity types'),
    },
  },

  // --- Claims ---
  {
    name: 'claims_validate',
    title: 'Pre-submission claim code and date check',
    description: 'Pre-submission check of a claim\'s codes and dates — no patient or provider identifiers needed or accepted. Checks that the diagnosis (ICD-10) and procedure (CPT/HCPCS) codes exist and are active, that modifiers are well-formed, and that the date of service is not in the future; returns whether the claim passed, with the errors and warnings found. Up to 25 diagnosis codes, 50 procedure codes and 20 modifiers per claim. It does not assess medical necessity or prior authorization — use pa_required_check or order_readiness_checklist for those requirements.',
    price: '$0.05',
    endpoint: '/agent/v1/claims/validate',
    annotations: PAID_LOOKUP,
    schema: {
      // PHI-free: no patient or provider identifier is declared, so zod strips
      // any that a caller sends — they never leave the client.
      claim: z.object({
        dateOfService: z.string().max(MAX_CLAIM_CODE).describe('YYYY-MM-DD'),
        diagnosisCodes: z.array(z.string().max(MAX_CLAIM_CODE)).max(25),
        procedureCodes: z.array(z.string().max(MAX_CLAIM_CODE)).max(50),
        modifiers: z.array(z.string().max(MAX_CLAIM_CODE)).max(20).optional(),
        placeOfService: text().optional(),
      }).describe('Claim data to validate'),
    },
  },

  // --- Compliance ---
  {
    name: 'compliance_audit',
    title: 'PHI-exposure compliance scan',
    description: 'PHI exposure scan for a text payload before it leaves your system: pattern checks for SSN, MRN and date-of-birth formats, with findings by severity, a 0-100 score and remediation notes. Pattern-based screening, not a compliance audit. Payload up to 20,000 characters. Costs 250 credits — run it on a sample, not on every record.',
    price: '$0.25',
    endpoint: '/agent/v1/compliance/audit',
    annotations: PAID_LOOKUP,
    schema: {
      // A record cannot carry a size in JSON Schema; the refinement caps its
      // serialized length (the hosted copy's serializedLimits).
      data: z.record(z.unknown())
        .refine((v) => JSON.stringify(v).length <= MAX_CLINICAL_TEXT, `data must serialize to at most ${MAX_CLINICAL_TEXT} characters`)
        .describe('Data to audit for compliance issues'),
      auditType: anyCaseEnum(['general', 'hipaa']).optional().describe('Type of audit (default: general)'),
    },
  },

  // --- Drug Intelligence (OpenFDA — free, no license) ---
  {
    name: 'drug_lookup',
    title: 'Drug label and adverse-event lookup (OpenFDA)',
    description: 'Look up drug information including label data, adverse events, and related diagnosis codes. Source: OpenFDA (public domain).',
    price: '$0.01',
    endpoint: '/agent/v1/drugs/lookup',
    annotations: PAID_OPEN_WORLD,
    schema: {
      drugName: text().describe('Drug name (brand, generic, or substance — min 2 chars)'),
      searchField: anyCaseEnum(['brand_name', 'generic_name', 'product_ndc', 'substance_name']).optional().describe('Search field (default: brand_name)'),
    },
  },
  {
    name: 'drug_interactions',
    title: 'Drug-drug interaction signals (FDA FAERS)',
    description: 'Check drug-drug interaction signals from FDA adverse event co-reports. Returns co-reported reactions and signal strength. Source: OpenFDA FAERS (public domain).',
    price: '$0.03',
    endpoint: '/agent/v1/drugs/interactions',
    annotations: PAID_OPEN_WORLD,
    schema: {
      drugs: z.array(text()).min(2).max(5).describe('Array of 2-5 drug names to check for interactions'),
    },
  },

  // --- Reimbursement Rates (CMS PFS — public domain) ---
  {
    name: 'code_reimbursement',
    title: 'Medicare reimbursement rates (CMS PFS + OPPS)',
    description: 'Look up Medicare reimbursement rates for a medical code. Returns RVU values and estimated payment amounts using the PFS conversion factor. Source: the current Medicare PFS (CMS RVU files, public domain).',
    price: '$0.01',
    endpoint: '/agent/v1/codes/reimbursement',
    annotations: PAID_LOOKUP,
    schema: {
      code: text().describe('Medical code (e.g., "99213", "M79.3")'),
      codeType: anyCaseEnum(['ICD10', 'CPT', 'HCPCS']).optional().describe('Code system (auto-detected if omitted)'),
    },
  },
  {
    name: 'fee_schedule_lookup',
    title: 'DMEPOS fee schedule (state + modifier specific)',
    description: 'Look up the CMS DMEPOS fee schedule for a DME/orthotic/prosthetic HCPCS code: rental (RR) vs purchase (NU new / UE used), non-rural vs rural, per state. Give a state for exact rates, or omit for national min–max ranges; filter by modifier to narrow to rental or purchase. Source: the current CMS DMEPOS fee schedule quarter. For professional-service (CPT) payment use code_reimbursement instead.',
    price: '$0.01',
    endpoint: '/agent/v1/codes/fee-schedule',
    annotations: PAID_LOOKUP,
    schema: {
      code: text().describe('DMEPOS HCPCS code (e.g., "E0601", "K0800", "E1390")'),
      state: text().optional().describe('2-letter US jurisdiction (50 states + DC/PR/VI) for exact non-rural/rural rates; omit for national ranges'),
      modifier: anyCaseEnum(['RR', 'NU', 'UE']).optional().describe('Narrow to rental (RR) or purchase (NU new / UE used)'),
    },
  },

  // --- Clinical Trials (ClinicalTrials.gov — free, no license) ---
  {
    name: 'trials_search',
    title: 'Clinical trials search (ClinicalTrials.gov)',
    description: 'Search active clinical trials by condition, ICD-10 code, or intervention. Returns trial details including NCT ID, phase, enrollment, and eligibility. Source: ClinicalTrials.gov (public domain).',
    price: '$0.03',
    endpoint: '/agent/v1/trials/search',
    annotations: PAID_OPEN_WORLD,
    schema: {
      condition: z.string().max(MAX_TRIALS_QUERY).optional().describe('Medical condition to search for'),
      code: z.string().max(MAX_TRIALS_QUERY).optional().describe('ICD-10 code (auto-mapped to condition)'),
      intervention: z.string().max(MAX_TRIALS_QUERY).optional().describe('Drug or intervention name'),
      status: anyCaseEnum(['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'COMPLETED', 'NOT_YET_RECRUITING']).optional().describe('Trial status filter (default: RECRUITING)'),
      limit: z.number().min(1).max(MAX_RESULTS).optional().describe('Max results (default 10, max 50)'),
    },
  },

  // --- Code Cross-Reference ---
  {
    name: 'code_crossref',
    title: 'Medical code cross-reference (ICD-10 / CPT / HCPCS)',
    description: 'Cross-reference a medical code across ICD-10, CPT, and HCPCS systems. Returns related codes grouped by system. Source: CodeReference DB (ICD-10/HCPCS: public domain).',
    price: '$0.02',
    endpoint: '/agent/v1/codes/crossref',
    annotations: PAID_LOOKUP,
    schema: {
      code: text().describe('Medical code to cross-reference (e.g., "M79.3", "99213", "E0601")'),
    },
  },

  // --- RxNorm Drug Lookup (NIH — free, no license) ---
  {
    name: 'drug_rxnorm',
    title: 'RxNorm drug normalization (NIH)',
    description: 'Normalize a drug name with NIH RxNorm: returns the matching RxNorm concepts (RxCUI, name, synonym, term type) and the primary RxCUI. It does not check interactions — use drug_interactions for drug-drug interaction signals. Source: NIH RxNorm (public domain).',
    price: '$0.02',
    endpoint: '/agent/v1/drugs/rxnorm',
    annotations: PAID_OPEN_WORLD,
    // No interaction input: NLM retired the RxNav interaction API on 2024-01-02.
    schema: {
      drugName: text().describe('Drug name to look up (min 2 chars)'),
    },
  },

  // --- Physician Payments (CMS Open Payments — free, no license) ---
  {
    name: 'provider_payments',
    title: 'Physician industry payments (CMS Open Payments)',
    description: 'Look up pharmaceutical and device company payments to a physician (Sunshine Act data). Returns total payments, breakdown by type, and top paying companies. Source: CMS Open Payments (public domain).',
    price: '$0.02',
    endpoint: '/agent/v1/providers/payments',
    annotations: PAID_OPEN_WORLD,
    schema: {
      npi: text().describe('10-digit NPI number of the physician'),
    },
  },

  // --- Disease Surveillance (CDC NNDSS — free, no license) ---
  {
    name: 'disease_surveillance',
    title: 'Disease surveillance case counts (CDC NNDSS)',
    description: 'Look up disease surveillance data including case counts and trends by condition and geography. Source: CDC National Notifiable Diseases Surveillance System (public domain).',
    price: '$0.02',
    endpoint: '/agent/v1/surveillance/disease',
    annotations: PAID_OPEN_WORLD,
    schema: {
      condition: text().optional().describe('Disease or condition name (e.g., "Hepatitis A", "Salmonellosis")'),
      code: text().optional().describe('ICD-10 code (auto-mapped to condition name)'),
      state: text().optional().describe('2-letter state code to filter by geography'),
    },
  },

  // --- Data Enrichment ---
  {
    name: 'provider_search',
    title: 'NPI provider directory search',
    description: 'Search the NPI provider directory. Find healthcare providers by name, specialty, or location.',
    price: '$0.005',
    endpoint: '/agent/v1/providers/search',
    annotations: PAID_OPEN_WORLD,
    schema: {
      firstName: z.string().max(MAX_NAME).optional(),
      lastName: z.string().max(MAX_NAME).optional(),
      organizationName: z.string().max(MAX_NAME).optional(),
      taxonomy: text().optional().describe('Provider taxonomy/specialty code'),
      city: text().optional(),
      state: text().optional().describe('2-letter state code'),
      limit: z.number().min(1).max(MAX_RESULTS).optional().describe('Max results (default 10, max 50)'),
    },
  },
  {
    name: 'provider_enrich',
    title: 'AI-enriched provider intelligence (NPI)',
    description: 'Look up a provider by NPI in the CMS NPPES registry (name, credential, primary and other taxonomies, practice address, enumeration date) and add an LLM-generated estimate, labelled as such, of specialty demand, network gaps and referral categories for that type of provider. The model is given the provider type — specialty, taxonomy, credential, state, entity type and enumeration date — never the name or NPI. Not a CMS or quality measure. A failed call (unknown NPI, model unavailable) is refunded.',
    price: '$0.05',
    endpoint: '/agent/v1/providers/enrich',
    annotations: PAID_OPEN_WORLD,
    schema: {
      npi: text().describe('10-digit NPI number'),
    },
  },
  {
    name: 'drug_enrich',
    title: 'AI-enriched drug intelligence (OpenFDA)',
    description: 'Drug information enrichment via OpenFDA. Returns drug details, indications, interactions, and AI analysis.',
    price: '$0.03',
    endpoint: '/agent/v1/drugs/enrich',
    annotations: PAID_OPEN_WORLD,
    schema: {
      drugName: text().describe('Drug name (brand or generic, min 2 chars)'),
      searchField: anyCaseEnum(['brand_name', 'generic_name']).optional().describe('Search by brand or generic name'),
    },
  },
  {
    name: 'market_analysis',
    title: 'Healthcare specialty market analysis by state',
    description: 'Specialty snapshot for a US state: how many providers one CMS NPPES registry query matches for the specialty (the query returns at most 200 records, so the figure is a floor, not a provider count), plus an LLM-generated estimate, labelled as such, of demand outlook, likely underserved areas and opportunities. Not a CMS or quality measure. A failed call (model unavailable) is refunded.',
    price: '$0.10',
    endpoint: '/agent/v1/market/analysis',
    annotations: PAID_OPEN_WORLD,
    schema: {
      state: anyCaseEnum(US_STATE_CODES).describe('2-letter state code (e.g., "TX", "CA")'),
      specialty: z.string().max(MAX_NAME).describe('Medical specialty (e.g., "cardiology", "orthopedics")'),
    },
  },

  // --- Account & Billing (free — uses your connector sign-in or API key) ---
  {
    name: 'account_status',
    title: 'Account status — credit balance and usage (free)',
    description: 'Check your MyMedi-AI account: current credit balance, USD equivalent, transaction count, recent transactions, and last activity. Free — never bills credits. Uses your connector sign-in (or X-API-Key when self-hosted).',
    price: 'free',
    auth: true,
    method: 'GET',
    endpoint: '/bot-marketplace/balance',
    annotations: FREE_LOOKUP,
    schema: {},
  },
  {
    name: 'buy_credits',
    title: 'Buy credits — get a Stripe checkout link',
    description: 'Top up your MyMedi-AI credits. Creates a Stripe Checkout session and returns a checkoutUrl for you to open and complete payment in the browser — calling this tool charges nothing by itself. Specify amount (USD, min $1 = 1,000 credits) or package (starter $1, basic $5, standard $25, professional $100, enterprise $500). 1 credit = $0.001; credits are added automatically after checkout.',
    price: 'free',
    auth: true,
    method: 'POST',
    endpoint: '/bot-marketplace/credits/purchase',
    // NOT read-only: creates a Stripe checkout session (no charge until the
    // user completes checkout in the browser; a new session per call). An
    // account tool: it acts on the caller's own MyMedi-AI account.
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    schema: {
      amount: z.number().min(1).max(10000).optional().describe('USD amount to purchase (min $1 = 1,000 credits)'),
      package: anyCaseEnum(['starter', 'basic', 'standard', 'professional', 'enterprise']).optional().describe('Named package: starter $1/1k, basic $5/5k, standard $25/25k, professional $100/100k, enterprise $500/500k credits (alternative to amount)'),
    },
  },
];

/**
 * Server instructions for the MCP `initialize` result — pass as
 * `new McpServer(info, { instructions: SERVER_INSTRUCTIONS })`. The hosted
 * connector builds the same text from its own copy of the catalog, and the
 * app repo's parity test holds the two strings equal.
 */
export const SERVER_INSTRUCTIONS = buildServerInstructions(MCP_TOOLS, { isPerCode: (t) => Boolean(t.schema.codes) });

export function getToolByName(name) {
  return MCP_TOOLS.find((t) => t.name === name);
}
