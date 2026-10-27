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
const MAX_CODE_DESCRIPTION = 500; // code_suggest: the search reads no more
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
    description: 'Look up basic metadata for a medical code: code, codeType, description, category, isActive. Basic metadata only. Free, no API key required.',
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
    description: 'Blank pre-delivery checklist for a HCPCS DMEPOS code: the universal standard written order (SWO) elements (42 CFR 410.38(d)), whether the code is on the current CMS Required Face-to-Face Encounter & Written Order Prior to Delivery List (F2F/WOPD), and whether it is on the current CMS Required Prior Authorization List, on a date of service (default today). Some items are phased in by state: for those, paRequired is null until a state is given. Requirement definitions only; it takes no patient data (PHI-free). Free, no API key required.',
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
    description: 'Editorial guidance on DMEPOS billing modifiers: the KX/GA/GY/GZ medical-necessity and liability family, RR/NU/UE rental-vs-purchase, capped-rental month markers (KH/KI/KJ), and RT/LT laterality. A HCPCS code scopes the guidance to that item\'s DMEPOS category (a category can also be given directly), and a scenario phrase (e.g., "ABN on file", "bilateral") surfaces the relevant modifiers. Original editorial content, not payer policy. PHI-free. Free, no API key required.',
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
    description: 'Look up a list of medical codes (ICD-10, CPT, HCPCS) in one call. Each item returns what a single lookup does (description, category, active status, related codes, DMEPOS fee schedule with optional state filter). Priced per code — $0.001 × number of codes, max 25 per call; the full charge is refunded automatically when every code misses.',
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
    description: 'Suggest ICD-10-CM, CPT and HCPCS Level II codes from a clinical or equipment description — a term search over the 90K-code CMS database, no language model. Works with natural sentences ("patient with obstructive sleep apnea prescribed CPAP" lists G47.33 and E0601 first), common abbreviations and alternate forms (CPAP, OSA, COPD, IG for immune globulin, type 2), and a typed side, sex or "without". Ranked by relevance (relevanceScore 0-1: how much of the description a code matches, and how closely), with two exceptions: the best code for each separate thing a description names (a diagnosis and a device) comes first, so the list is grouped rather than strictly sorted by relevanceScore; and a bare common condition ("hypertension") lists its ICD-10-CM default code first. Weak matches are left out rather than listed. Up to 500 characters, of which up to 10 distinct terms are searched, common words left out. Automatically refunds the call when nothing matches.',
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
    description: 'Check that an ICD-10-CM, CPT or HCPCS Level II code exists and is valid on a date of service: termination and effective dates are applied, so a code deleted after that date still validates. dateOfService is YYYY-MM-DD (default today); asOf in the result is the date the code was judged for. Returns valid, active, warnings and errors.',
    price: '$0.005',
    endpoint: '/agent/v1/codes/validate',
    annotations: PAID_LOOKUP,
    schema: {
      code: text().describe('Medical code to validate'),
      codeType: anyCaseEnum(['icd10', 'cpt', 'hcpcs']).optional(),
      dateOfService: z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date of service, YYYY-MM-DD (default today)'),
      date_of_service: z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Same as dateOfService (snake_case spelling)'),
      context: z.object({
        dateOfService: z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Same as dateOfService; if both are sent they must match'),
        date_of_service: z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Same as dateOfService (snake_case spelling)'),
      }).optional(),
    },
  },

  {
    name: 'code_validate_batch',
    title: 'Batch medical code validation (up to 25 codes)',
    description: 'Validate up to 25 medical codes in one call, each judged as in a single validation: exists, and is valid on the date of service (dateOfService, YYYY-MM-DD, applied to every code; default today). Each item returns valid, active, asOf, warnings, errors and codeDetails. Priced per code — $0.005 × number of codes, max 25 per call. An invalid code is a billable answer (valid:false).',
    price: '$0.005',
    endpoint: '/agent/v1/codes/validate-batch',
    annotations: PAID_LOOKUP,
    schema: {
      codes: z.array(text()).min(1).max(25).describe('Medical codes to validate (1-25 per call)'),
      codeType: anyCaseEnum(['icd10', 'cpt', 'hcpcs']).optional().describe('Code system applied to every code'),
      dateOfService: z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date of service, YYYY-MM-DD, applied to every code (default today)'),
      date_of_service: z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Same as dateOfService (snake_case spelling)'),
      context: z.object({
        dateOfService: z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Same as dateOfService; if both are sent they must match'),
        date_of_service: z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Same as dateOfService (snake_case spelling)'),
      }).optional(),
    },
  },

  // --- Prior Authorization ---
  {
    name: 'pa_predict',
    title: 'Prior-auth approval rate + CMS requirement facts',
    description: 'Historical prior-authorization approval rate for a procedure code, computed only from your organization\'s own decided prior authorizations for that code — never from other customers\' records — and only from at least 10; an API key or account with no organization has no cohort. With a cohort it returns the rate with cohort size and confidence; without one it returns the verifiable facts instead — CMS Required Prior Authorization List status, category, and published review timeframes — and reports that no rate was computed (the call is refunded on this path). Either way its recommendation states the CMS requirement only. It reports past decisions and makes no coverage or prior-authorization determination. Original Medicare FFS scope.',
    price: '$0.05',
    endpoint: '/agent/v1/pa/predict',
    annotations: PAID_LOOKUP,
    schema: {
      procedureCode: text().describe('CPT/HCPCS procedure code (e.g., "E0651", "K0800")'),
      payerId: text().optional().describe('Payer category, e.g. "MEDICARE", "AETNA" or "UNITED_HEALTHCARE" (any letter case) — narrows your organization\'s own decided-PA cohort to that payer. A payer\'s own ID number names no category, so it finds no cohort.'),
    },
  },
  {
    name: 'pa_status',
    title: 'Prior authorization status check',
    description: 'Check the status of a prior authorization request tracked in your MyMedi-AI web workspace (by its MyMedi-AI PA id). Returns current status, dates, and expiration info. It does not query payers or say whether a code requires prior authorization, and returns not-found (refunded) if the PA was never entered in the web app.',
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
    description: 'Map a supplier HCPCS catalog against the current CMS Required Prior Authorization List and Required Face-to-Face Encounter & Written Order Prior to Delivery List on a date of service (default today). Per code: PA requirement and the date it applies from, F2F/WOPD requirement, documentation gates (SWO, UTN-before-claim, F2F/WOPD sequencing), and deterministic denial-risk flags — plus a catalog-level exposure summary. Some items are phased in by state: with a state the answer is definitive; without one they are reported as required in some states (paRequiredInSomeStates). Unknown or non-HCPCS codes are flagged and count as billable answers. Priced per code — $0.01 × number of codes, max 100 per call. Returns JSON. Original Medicare FFS scope. PHI-free: codes in, rules out.',
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
    title: 'Extract ICD-10-CM, HCPCS and CPT codes and dates from clinical text',
    description: 'Extract the medical codes already present in de-identified text and check each against the MyMedi-AI code database: ICD-10-CM codes whole, dotted or undotted, with their 7th-character extensions (S72.001A, S72001A); HCPCS Level II codes (a letter A–V and four digits), with modifiers attached (E0601RR, E0601-RR) reported as modifiers — a glued suffix only when it is a known DMEPOS modifier; and CPT codes only where a keyword such as CPT or procedure code marks them (Category II and III and PLA codes such as 0001U included), so ZIP codes and other numbers are not read as codes, and a five-digit number that continues a marked list is kept only when the CPT set holds it. Codes are read in upper case, as code sets print them; lower-case text is not read as a code. Each code entity says whether the code set holds it (inCodeSet) and, when it does, gives its description and whether it is active; an undotted ICD-10-CM shape is returned only when the code set holds it, so words such as B12 are not read as codes. codeSets names the code-set releases checked. Also returns M/D/Y dates and one MEDICATION_INDICATOR entity when a dose unit (mg, mcg or mL) appears. It does not extract drug names and does not infer or suggest codes. PHI-free: for de-identified text only.',
    price: '$0.02',
    endpoint: '/agent/v1/ner/extract',
    annotations: PAID_LOOKUP,
    schema: {
      text: z.string().max(MAX_CLINICAL_TEXT).describe('Clinical text to extract entities from'),
      entityTypes: z.array(z.string().max(30)).max(10).optional().describe('Return only these entity types: ICD10_CODE, HCPCS_CODE, CPT_CODE, DATE, MEDICATION_INDICATOR (any letter case; default all). Any other type is refused, and refunded.'),
    },
  },

  // --- Claims ---
  {
    name: 'claims_validate',
    title: 'Pre-submission claim code and date check',
    description: 'Pre-submission check of a claim\'s codes and dates — no patient or provider identifiers needed or accepted. Checks that the diagnosis (ICD-10-CM) and procedure (CPT/HCPCS Level II) codes exist and are active on the date of service, that modifiers are well-formed, and that the date of service is not in the future; returns whether the claim passed, with the errors and warnings found. A CPT code missing from the loaded CMS fee schedule file, or a modifier this reference does not list for DMEPOS, is a warning, not an error. Up to 25 diagnosis codes, 50 procedure codes and 20 modifiers per claim. It applies no NCCI edits — neither procedure-to-procedure (PTP) pairs nor MUE unit limits — and does not assess medical necessity or prior authorization.',
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
    title: 'DMEPOS order documentation audit (SWO, F2F/WOPD, prior auth)',
    description: 'Audit one DMEPOS order\'s documentation against the Original Medicare requirements that apply to its HCPCS code on the date of service: the standard written order (SWO) elements (42 CFR 410.38(d)(1)(i)); for items on the current CMS Required Face-to-Face Encounter & Written Order Prior to Delivery List, a face-to-face encounter within the 6 months before the order and the written order before delivery, otherwise the written order before the claim; and for items on the current CMS Required Prior Authorization List, an affirmed decision before delivery. Some items are phased in by state: without a state such an order is refused (refunded) unless an affirmed decision is reported. A code the HCPCS set does not hold, one not valid on the date of service, or one the CMS DMEPOS Jurisdiction List bills to the A/B MAC (Part B) rather than a DME MAC, or a discontinued code that list does not show, is refused (refunded); for a code under joint jurisdiction the answer gives CMS\'s wording of when the A/B MAC takes it. Each fact is a true/false flag; no names, identifiers, signatures or other values are taken. Each requirement comes back pass or fail with its citation; a fact not reported fails, and any failed requirement fails the order (result: fail). It checks the facts reported, not the documents themselves. Not checked: LCD coverage criteria and medical-necessity documentation, proof of delivery and billing modifiers. Costs 250 credits per call.',
    price: '$0.25',
    endpoint: '/agent/v1/compliance/audit',
    annotations: PAID_LOOKUP,
    schema: {
      // PHI-free: the order is described by yes/no facts. No identifier field
      // is declared, so zod strips any a caller sends.
      data: z.object({
        code: text().describe('HCPCS Level II code of the ordered item (e.g., "K0823")'),
        dateOfService: z.string().max(MAX_DATE).describe('Date of service (for DME, the delivery date), YYYY-MM-DD'),
        state: phasedState(),
        swo: z.object({
          beneficiaryName: z.boolean().optional().describe('Beneficiary name or Medicare Beneficiary Identifier (MBI)'),
          itemDescription: z.boolean().optional().describe('General description of the item'),
          quantity: z.boolean().optional().describe('Quantity to be dispensed, if applicable'),
          orderDate: z.boolean().optional().describe('Order date'),
          practitionerName: z.boolean().optional().describe('Treating practitioner name or NPI'),
          practitionerSignature: z.boolean().optional().describe('Treating practitioner signature'),
        }).optional().describe('Standard written order elements: true when on the order (quantity: also when none applies), false when missing — never the values'),
        faceToFaceWithin6Months: z.boolean().optional().describe('F2F/WOPD items: a face-to-face encounter with the treating practitioner within the 6 months before the order date'),
        orderBeforeDelivery: z.boolean().optional().describe('F2F/WOPD items: the written order reached the supplier before delivery'),
        orderBeforeClaim: z.boolean().optional().describe('Other items: the written order reached the supplier before the claim is submitted'),
        priorAuthorization: anyCaseEnum(['affirmed', 'non_affirmed', 'pending', 'not_requested']).optional().describe('Prior-authorization items: "affirmed" when an affirmed decision was received before delivery'),
      }).describe('The order: its HCPCS code, date of service and state, and true/false facts about its documentation'),
      auditType: anyCaseEnum(['dme_order']).optional().describe('Optional: "dme_order", the only audit (the default)'),
    },
  },

  // --- Drug Intelligence (openFDA) ---
  {
    name: 'drug_lookup',
    title: 'Drug label and adverse-event lookup (OpenFDA)',
    description: 'Look up drug information including label data, adverse events, and related diagnosis codes. Source: openFDA (FDA drug labels and adverse-event reports); related diagnosis codes come from the MyMedi-AI code database.',
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
    title: 'Drug-combination adverse-event disproportionality (FDA FAERS)',
    description: 'Adverse event reports that name drugs together: coReportCount, the number of FAERS reports naming every listed drug; the reactions most often named in them; and for each reaction a proportional reporting ratio (PRR) with a 95% confidence interval against the reports of each drug without the others. A reaction is marked disproportionate when it has at least 3 co-reports and the lower bound exceeds 1 against every drug (null when a comparison cannot be computed). Drugs are matched by the product name as reported: a brand name such as Coumadin is not merged with its generic, warfarin. A name no FAERS report names is refused (refunded), naming it. FAERS reports are unverified and can be duplicated: report counts and disproportionality are statistical associations, not evidence of an interaction or of causation, and no substitute for a clinical drug-interaction reference. Source: the FDA Adverse Event Reporting System (FAERS), via openFDA.',
    price: '$0.03',
    endpoint: '/agent/v1/drugs/interactions',
    annotations: PAID_OPEN_WORLD,
    schema: {
      drugs: z.array(text()).min(2).max(5).describe('Array of 2-5 different drug names (brand or generic), each matched against the product name reported in FAERS. Drug names need at least two letters or digits and may otherwise hold only spaces, hyphens, apostrophes, periods, slashes, parentheses and commas; accents, curly apostrophes, ® and ™, "+" and "&", and strengths such as 0.5% or 1:100,000 are normalized first (a refused name is refunded)'),
    },
  },

  // --- Reimbursement Rates (CMS PFS) ---
  {
    name: 'code_reimbursement',
    title: 'Medicare reimbursement rates (CMS PFS + OPPS)',
    description: 'Look up Medicare reimbursement rates for a medical code. Returns RVU values and estimated payment amounts using the PFS conversion factor. Source: the current Medicare PFS (CMS RVU files).',
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
    description: 'Look up the CMS DMEPOS fee schedule for a DME/orthotic/prosthetic HCPCS code: rental (RR) vs purchase (NU new / UE used), non-rural vs rural, per state. With a state it returns that state\'s exact rates, without one national min–max ranges; a modifier narrows the answer to rental or purchase. Source: the current CMS DMEPOS fee schedule quarter. It has no professional-service (CPT) rates.',
    price: '$0.01',
    endpoint: '/agent/v1/codes/fee-schedule',
    annotations: PAID_LOOKUP,
    schema: {
      code: text().describe('DMEPOS HCPCS code (e.g., "E0601", "K0800", "E1390")'),
      state: text().optional().describe('2-letter US jurisdiction (50 states + DC/PR/VI) for exact non-rural/rural rates; national ranges when omitted'),
      modifier: anyCaseEnum(['RR', 'NU', 'UE']).optional().describe('Narrow to rental (RR) or purchase (NU new / UE used)'),
    },
  },

  // --- Clinical Trials (ClinicalTrials.gov) ---
  {
    name: 'trials_search',
    title: 'Clinical trials search (ClinicalTrials.gov)',
    description: 'Search active clinical trials by condition, ICD-10 code, or intervention. Returns trial details including NCT ID, phase, enrollment, and eligibility. Source: ClinicalTrials.gov.',
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
    description: 'Related codes for an ICD-10-CM, CPT or HCPCS Level II code, across the three code systems. linkedCodes are curated: the DME code family (base item, accessories and supplies) and links across code systems that cite their CMS source — obstructive sleep apnea (G47.33) with the PAP devices CMS LCD L33718 covers and the sleep tests NCD 240.4.1 covers. crossReferences are other active codes whose descriptions best match this one, grouped by code system (up to 5 each) with a relevanceScore (0-1); weaker matches are left out, so a group can be empty, and a code with no related codes at all is refunded. Source: the MyMedi-AI code database (ICD-10-CM, CPT and HCPCS Level II code sets).',
    price: '$0.02',
    endpoint: '/agent/v1/codes/crossref',
    annotations: PAID_LOOKUP,
    schema: {
      code: text().describe('Medical code to cross-reference (e.g., "M79.3", "99213", "E0601")'),
    },
  },

  // --- RxNorm Drug Lookup (NLM RxNav) ---
  {
    name: 'drug_rxnorm',
    title: 'RxNorm drug normalization (NIH)',
    description: 'Normalize a drug name with NIH RxNorm: returns the matching RxNorm concepts (RxCUI, name, synonym, term type) and the primary RxCUI. It does not check interactions. Source: RxNorm, from the U.S. National Library of Medicine (RxNav API).',
    price: '$0.02',
    endpoint: '/agent/v1/drugs/rxnorm',
    annotations: PAID_OPEN_WORLD,
    // No interaction input: NLM retired the RxNav interaction API on 2024-01-02.
    schema: {
      drugName: text().describe('Drug name to look up (min 2 chars)'),
    },
  },

  // --- Physician Payments (CMS Open Payments) ---
  {
    name: 'provider_payments',
    title: 'Physician industry payments (CMS Open Payments)',
    description: 'Look up pharmaceutical and device company payments to a physician (Sunshine Act data). Returns total payments, breakdown by type, and top paying companies. Source: CMS Open Payments.',
    price: '$0.02',
    endpoint: '/agent/v1/providers/payments',
    annotations: PAID_OPEN_WORLD,
    schema: {
      npi: text().describe('10-digit NPI number of the physician'),
    },
  },

  // --- Disease Surveillance (CDC NNDSS) ---
  {
    name: 'disease_surveillance',
    title: 'Disease surveillance case counts (CDC NNDSS)',
    description: 'Look up disease surveillance data including case counts and trends by condition and geography. Source: CDC National Notifiable Diseases Surveillance System (NNDSS) weekly data on data.cdc.gov.',
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
      taxonomy: text().optional().describe('Provider specialty as an NPPES (NUCC) taxonomy description, e.g. "Family Medicine"; a trailing * matches a prefix'),
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
    title: 'Drug label data with an LLM summary (openFDA)',
    description: 'Look up a drug by brand or generic name in openFDA and return its first matching FDA label: brand and generic name, manufacturer, NDCs, route, substance, product type, and the label\'s indications, warnings, dosage and administration, adverse reactions and drug-interactions sections (null when the label has no such section). Adds an LLM-generated summary, labelled as such: the therapeutic class and the indications the label states. It gives no treatment advice, does not check interactions between drugs, and makes no prior-authorization, coverage or cost determination. A failed call (drug not found, openFDA or the model unavailable) is refunded.',
    price: '$0.03',
    endpoint: '/agent/v1/drugs/enrich',
    annotations: PAID_OPEN_WORLD,
    schema: {
      drugName: text().describe('Drug name (brand or generic, min 2 chars)'),
      searchField: anyCaseEnum(['brand_name', 'generic_name']).optional().describe('Match the name against the label\'s brand name or generic name (default: brand_name)'),
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
      specialty: z.string().max(MAX_NAME).describe('Medical specialty as an NPPES (NUCC) taxonomy description, e.g. "Pulmonary Disease", "Cardiovascular Disease" or "Orthopaedic Surgery"; a trailing * matches a prefix ("Pulmon*")'),
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
    description: 'Top up your MyMedi-AI credits. Creates a Stripe Checkout session and returns a checkoutUrl for you to open and complete payment in the browser — calling this tool charges nothing by itself. It takes an amount (USD, min $1 = 1,000 credits) or a package (starter $1, basic $5, standard $25, professional $100, enterprise $500). 1 credit = $0.001; credits are added automatically after checkout.',
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
