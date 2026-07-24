/**
 * MCP Tool Definitions for MyMedi-AI Healthcare Agent API
 * 32 tools: 6 free no-auth + 24 x402-protected + 2 account/billing (auth, free)
 * REST endpoints mapped to MCP tool format.
 * Uses Zod schemas (required by @modelcontextprotocol/sdk >=1.28).
 */
import { z } from 'zod';

// All tools are read-only API lookups/predictors — none mutate anything.
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export const MCP_TOOLS = [
  // --- Free, no API key (GET endpoints, rate-limited 60/hr/IP server-side) ---
  {
    name: 'pa_required_check',
    title: 'Medicare DMEPOS prior-auth required check (free)',
    description: 'Check whether a HCPCS code is on the CMS Required Prior Authorization List (42 CFR 414.234). Returns paRequired flag, category, nationwide-since date, and list version. Original Medicare FFS scope. Free, no API key required.',
    price: 'free',
    auth: false,
    method: 'GET',
    endpoint: '/agent/v1/codes/pa-required',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      code: z.string().describe('HCPCS Level II code (e.g., "E0651")'),
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
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      code: z.string().describe('CARC denial code (e.g., "CO-50", "PR-1", "197")'),
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
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      code: z.string().describe('Medical code to look up (e.g., "M79.3")'),
    },
  },
  {
    name: 'reimbursement_basic',
    title: 'Medicare national payment rate (free)',
    description: 'Look up Medicare payment for a code. Returns the national PFS facility and non-facility payment (CMS RVU × conversion factor) for professional services, plus DMEPOS fee-schedule ranges (rental/purchase, min–max across state fees) for DME items like E/K/L codes. Free, no API key required.',
    price: 'free',
    auth: false,
    method: 'GET',
    endpoint: '/agent/v1/codes/reimbursement-basic',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      code: z.string().describe('Medical code (e.g., "97110" or "E1390")'),
    },
  },
  {
    name: 'order_readiness_checklist',
    title: 'DMEPOS order-readiness checklist (free)',
    description: 'Blank pre-delivery checklist for a HCPCS DMEPOS code: the universal standard written order (SWO) elements (42 CFR 410.38(d)), whether the code requires a face-to-face encounter and written order prior to delivery (F2F/WOPD), and whether it is on the Medicare Required Prior Authorization List. Requirement definitions only — PHI-free, never send patient data. Free, no API key required.',
    price: 'free',
    auth: false,
    method: 'GET',
    endpoint: '/agent/v1/codes/order-readiness',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      code: z.string().describe('HCPCS Level II code (e.g., "E0466")'),
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
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      code: z.string().optional().describe('HCPCS DMEPOS code to scope guidance to (e.g., "E0601")'),
      category: z.string().optional().describe('DMEPOS category instead of a code (e.g., "oxygen", "capped-rental", "prosthetics")'),
      scenario: z.string().optional().describe('Optional situation phrase (e.g., "ABN on file", "bilateral AFO", "converting rental to purchase")'),
    },
  },

  // --- Medical Coding ---
  {
    name: 'code_lookup',
    title: 'Medical code lookup (ICD-10 / CPT / HCPCS)',
    description: 'Look up a medical code (ICD-10, CPT, HCPCS). Returns description, category, active status, and related codes. For DMEPOS (HCPCS) codes it also returns a labeled fee schedule: per-modifier (RR/NU/UE) national min–max ranges, or — when a state is given — that state\'s exact non-rural and rural rates. Source: CMS DMEPOS Fee Schedule (DME26-B).',
    price: '$0.001',
    endpoint: '/agent/v1/codes/lookup',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      code: z.string().describe('Medical code to look up (e.g., "M79.3", "99213", "E0601")'),
      codeType: z.enum(['icd10', 'cpt', 'hcpcs']).optional().describe('Code system (auto-detected if omitted)'),
      state: z.string().optional().describe('2-letter US jurisdiction (50 states + DC/PR/VI). For DMEPOS codes, returns that state\'s exact non-rural/rural fees instead of only the national range.'),
    },
  },
  {
    name: 'code_lookup_batch',
    title: 'Batch medical code lookup (up to 25 codes)',
    description: 'Look up a list of medical codes (ICD-10, CPT, HCPCS) in one call. Per-item results mirror code_lookup (description, category, active status, related codes, DMEPOS fee schedule with optional state filter). Priced per code — $0.001 × number of codes, max 25 per call; the full charge is refunded automatically when every code misses.',
    price: '$0.001',
    endpoint: '/agent/v1/codes/lookup-batch',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      codes: z.array(z.string()).min(1).max(25).describe('Medical codes to look up, e.g. ["E0601", "A7030", "M79.3"] (1-25 per call)'),
      codeType: z.enum(['icd10', 'cpt', 'hcpcs']).optional().describe('Code system applied to every code (auto-detected if omitted)'),
      state: z.string().optional().describe('2-letter US jurisdiction (50 states + DC/PR/VI). For DMEPOS codes, returns that state\'s exact non-rural/rural fees instead of only the national range.'),
    },
  },
  {
    name: 'code_suggest',
    title: 'Medical code suggestions from clinical text',
    description: 'Suggest ICD-10/CPT/HCPCS codes from a clinical description. Term-based search over the 81K-code CMS database, ranked by matched-term coverage and relevance. Works with natural sentences ("patient with obstructive sleep apnea prescribed CPAP"). Automatically refunds the call when nothing matches.',
    price: '$0.01',
    endpoint: '/agent/v1/codes/suggest',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      description: z.string().describe('Clinical description to find codes for (e.g., "chronic lower back pain")'),
      codeType: z.enum(['icd10', 'cpt', 'hcpcs']).optional().describe('Limit to specific code system'),
      limit: z.number().optional().describe('Max suggestions to return (default 10, max 50)'),
    },
  },
  {
    name: 'code_validate',
    title: 'Medical code validation',
    description: 'Validate a medical code for correctness, active status, and context. Returns warnings and errors.',
    price: '$0.005',
    endpoint: '/agent/v1/codes/validate',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      code: z.string().describe('Medical code to validate'),
      codeType: z.enum(['icd10', 'cpt', 'hcpcs']).optional(),
      context: z.object({
        dateOfService: z.string().optional().describe('Date of service (YYYY-MM-DD) for temporal validation'),
      }).optional(),
    },
  },
  {
    name: 'code_validate_batch',
    title: 'Batch medical code validation (up to 25 codes)',
    description: 'Validate a list of medical codes for correctness, active status, and optional date-of-service context in one call. Per-item results mirror code_validate (valid, active, warnings, errors, codeDetails). Priced per code — $0.005 × number of codes, max 25 per call. An invalid code is a billable answer (valid:false), same as the single validate.',
    price: '$0.005',
    endpoint: '/agent/v1/codes/validate-batch',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      codes: z.array(z.string()).min(1).max(25).describe('Medical codes to validate (1-25 per call)'),
      codeType: z.enum(['icd10', 'cpt', 'hcpcs']).optional().describe('Code system applied to every code'),
      context: z.object({
        dateOfService: z.string().optional().describe('Date of service (YYYY-MM-DD) for temporal validation, applied to every code'),
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
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      procedureCode: z.string().describe('CPT/HCPCS procedure code (e.g., "E0651", "K0800")'),
      payerId: z.string().optional().describe('Insurance payer ID — narrows the approval-rate cohort to that payer when historical data exists'),
    },
  },
  {
    name: 'pa_status',
    title: 'Prior authorization status check',
    description: 'Check the status of a prior authorization request. Returns current status, dates, and expiration info.',
    price: '$0.02',
    endpoint: '/agent/v1/pa/status',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      authorizationId: z.string().optional().describe('Prior authorization ID'),
      trackingNumber: z.string().optional().describe('Tracking number (alternative to authorizationId)'),
    },
  },
  {
    name: 'pa_exposure_report',
    title: 'PA/WOPD catalog exposure report (up to 100 codes)',
    description: 'Map a supplier HCPCS catalog against the CMS Required Prior Authorization List (74 items) and the Required Face-to-Face Encounter & Written Order Prior to Delivery List (83 items, effective 2026-04-13). Per code: PA requirement with nationwide-since date, F2F/WOPD requirement, documentation gates (SWO, UTN-before-claim, F2F/WOPD sequencing), and deterministic denial-risk flags — plus a catalog-level exposure summary. Unknown or non-HCPCS codes are flagged and count as billable answers. Priced per code — $0.01 × number of codes, max 100 per call. Returns JSON here; the REST endpoint also renders a branded PDF with {"format":"pdf"}. Original Medicare FFS scope. PHI-free: codes in, rules out.',
    price: '$0.01',
    endpoint: '/agent/v1/pa/exposure-report',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      codes: z.array(z.string()).min(1).max(100).describe('Supplier catalog HCPCS codes, e.g. ["E0651", "L0651", "K0856"] (1-100 per call)'),
    },
  },

  // --- NLP ---
  {
    name: 'ner_extract',
    title: 'Medical named-entity extraction from clinical text',
    description: 'Extract medical named entities from clinical text. Identifies ICD-10 codes, CPT codes, dates, medications, and 12 entity types with confidence scores.',
    price: '$0.02',
    endpoint: '/agent/v1/ner/extract',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      text: z.string().describe('Clinical text to extract entities from'),
      entityTypes: z.array(z.string()).optional().describe('Filter to specific entity types'),
    },
  },

  // --- Claims ---
  {
    name: 'claims_validate',
    title: 'Pre-submission claims validation',
    description: 'Pre-submission claims validation. Checks for errors, missing fields, code mismatches, and provides fix suggestions before you submit to the payer.',
    price: '$0.05',
    endpoint: '/agent/v1/claims/validate',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      claim: z.object({
        patientId: z.string(),
        providerId: z.string(),
        dateOfService: z.string().describe('YYYY-MM-DD'),
        diagnosisCodes: z.array(z.string()),
        procedureCodes: z.array(z.string()),
        modifiers: z.array(z.string()).optional(),
        placeOfService: z.string().optional(),
      }).describe('Claim data to validate'),
    },
  },

  // --- Compliance ---
  {
    name: 'compliance_audit',
    title: 'HIPAA compliance audit (PHI exposure scan)',
    description: 'HIPAA compliance audit. Scans data for PHI exposure (SSN, MRN, DOB patterns), returns findings with severity, score (0-100), and remediation recommendations.',
    price: '$0.25',
    endpoint: '/agent/v1/compliance/audit',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      data: z.record(z.unknown()).describe('Data to audit for compliance issues'),
      auditType: z.enum(['general', 'hipaa']).optional().describe('Type of audit (default: general)'),
    },
  },

  // --- Drug Intelligence (OpenFDA — free, no license) ---
  {
    name: 'drug_lookup',
    title: 'Drug label and adverse-event lookup (OpenFDA)',
    description: 'Look up drug information including label data, adverse events, and related diagnosis codes. Source: OpenFDA (public domain).',
    price: '$0.01',
    endpoint: '/agent/v1/drugs/lookup',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      drugName: z.string().describe('Drug name (brand, generic, or substance — min 2 chars)'),
      searchField: z.enum(['brand_name', 'generic_name', 'product_ndc', 'substance_name']).optional().describe('Search field (default: brand_name)'),
    },
  },
  {
    name: 'drug_interactions',
    title: 'Drug-drug interaction signals (FDA FAERS)',
    description: 'Check drug-drug interaction signals from FDA adverse event co-reports. Returns co-reported reactions and signal strength. Source: OpenFDA FAERS (public domain).',
    price: '$0.03',
    endpoint: '/agent/v1/drugs/interactions',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      drugs: z.array(z.string()).min(2).max(5).describe('Array of 2-5 drug names to check for interactions'),
    },
  },

  // --- Reimbursement Rates (CMS PFS — public domain) ---
  {
    name: 'code_reimbursement',
    title: 'Medicare reimbursement rates (CMS PFS + OPPS)',
    description: 'Look up Medicare reimbursement rates for a medical code. Returns RVU values and estimated payment amounts using CMS PFS conversion factor. Source: CMS PFS RVU 2026 (public domain).',
    price: '$0.01',
    endpoint: '/agent/v1/codes/reimbursement',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      code: z.string().describe('Medical code (e.g., "99213", "M79.3")'),
      codeType: z.enum(['ICD10', 'CPT', 'HCPCS']).optional().describe('Code system (auto-detected if omitted)'),
    },
  },
  {
    name: 'fee_schedule_lookup',
    title: 'DMEPOS fee schedule (state + modifier specific)',
    description: 'Look up the CMS DMEPOS fee schedule for a DME/orthotic/prosthetic HCPCS code: rental (RR) vs purchase (NU new / UE used), non-rural vs rural, per state. Give a state for exact rates, or omit for national min–max ranges; filter by modifier to narrow to rental or purchase. Source: CMS DMEPOS Fee Schedule DME26-B (Apr 2026). For professional-service (CPT) payment use code_reimbursement instead.',
    price: '$0.01',
    endpoint: '/agent/v1/codes/fee-schedule',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      code: z.string().describe('DMEPOS HCPCS code (e.g., "E0601", "K0800", "E1390")'),
      state: z.string().optional().describe('2-letter US jurisdiction (50 states + DC/PR/VI) for exact non-rural/rural rates; omit for national ranges'),
      modifier: z.enum(['RR', 'NU', 'UE']).optional().describe('Narrow to rental (RR) or purchase (NU new / UE used)'),
    },
  },

  // --- Clinical Trials (ClinicalTrials.gov — free, no license) ---
  {
    name: 'trials_search',
    title: 'Clinical trials search (ClinicalTrials.gov)',
    description: 'Search active clinical trials by condition, ICD-10 code, or intervention. Returns trial details including NCT ID, phase, enrollment, and eligibility. Source: ClinicalTrials.gov (public domain).',
    price: '$0.03',
    endpoint: '/agent/v1/trials/search',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      condition: z.string().optional().describe('Medical condition to search for'),
      code: z.string().optional().describe('ICD-10 code (auto-mapped to condition)'),
      intervention: z.string().optional().describe('Drug or intervention name'),
      status: z.enum(['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'COMPLETED', 'NOT_YET_RECRUITING']).optional().describe('Trial status filter (default: RECRUITING)'),
      limit: z.number().optional().describe('Max results (default 10, max 50)'),
    },
  },

  // --- Code Cross-Reference ---
  {
    name: 'code_crossref',
    title: 'Medical code cross-reference (ICD-10 / CPT / HCPCS)',
    description: 'Cross-reference a medical code across ICD-10, CPT, and HCPCS systems. Returns related codes grouped by system. Source: CodeReference DB (ICD-10/HCPCS: public domain).',
    price: '$0.02',
    endpoint: '/agent/v1/codes/crossref',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      code: z.string().describe('Medical code to cross-reference (e.g., "M79.3", "99213", "E0601")'),
    },
  },

  // --- RxNorm Drug Lookup (NIH — free, no license) ---
  {
    name: 'drug_rxnorm',
    title: 'RxNorm drug normalization and interactions (NIH)',
    description: 'Look up a drug in NIH RxNorm for normalized terminology (RxCUI) and optionally check clinical drug-drug interactions with severity ratings. Source: NIH RxNorm (public domain).',
    price: '$0.02',
    endpoint: '/agent/v1/drugs/rxnorm',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      drugName: z.string().describe('Drug name to look up (min 2 chars)'),
      checkInteractions: z.array(z.string()).optional().describe('Other drug names to check for clinical interactions against the primary drug'),
    },
  },

  // --- Physician Payments (CMS Open Payments — free, no license) ---
  {
    name: 'provider_payments',
    title: 'Physician industry payments (CMS Open Payments)',
    description: 'Look up pharmaceutical and device company payments to a physician (Sunshine Act data). Returns total payments, breakdown by type, and top paying companies. Source: CMS Open Payments (public domain).',
    price: '$0.02',
    endpoint: '/agent/v1/providers/payments',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      npi: z.string().describe('10-digit NPI number of the physician'),
    },
  },

  // --- Disease Surveillance (CDC NNDSS — free, no license) ---
  {
    name: 'disease_surveillance',
    title: 'Disease surveillance case counts (CDC NNDSS)',
    description: 'Look up disease surveillance data including case counts and trends by condition and geography. Source: CDC National Notifiable Diseases Surveillance System (public domain).',
    price: '$0.02',
    endpoint: '/agent/v1/surveillance/disease',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      condition: z.string().optional().describe('Disease or condition name (e.g., "Hepatitis A", "Salmonellosis")'),
      code: z.string().optional().describe('ICD-10 code (auto-mapped to condition name)'),
      state: z.string().optional().describe('2-letter state code to filter by geography'),
    },
  },

  // --- Data Enrichment ---
  {
    name: 'provider_search',
    title: 'NPI provider directory search',
    description: 'Search the NPI provider directory. Find healthcare providers by name, specialty, or location.',
    price: '$0.005',
    endpoint: '/agent/v1/providers/search',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      organizationName: z.string().optional(),
      taxonomy: z.string().optional().describe('Provider taxonomy/specialty code'),
      city: z.string().optional(),
      state: z.string().optional().describe('2-letter state code'),
      limit: z.number().optional().describe('Max results (default 10, max 50)'),
    },
  },
  {
    name: 'provider_enrich',
    title: 'AI-enriched provider intelligence (NPI)',
    description: 'AI-enriched provider intelligence from NPI number. Returns practice details, specialties, affiliations, and market context.',
    price: '$0.05',
    endpoint: '/agent/v1/providers/enrich',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      npi: z.string().describe('10-digit NPI number'),
    },
  },
  {
    name: 'drug_enrich',
    title: 'AI-enriched drug intelligence (OpenFDA)',
    description: 'Drug information enrichment via OpenFDA. Returns drug details, indications, interactions, and AI analysis.',
    price: '$0.03',
    endpoint: '/agent/v1/drugs/enrich',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      drugName: z.string().describe('Drug name (brand or generic, min 2 chars)'),
      searchField: z.enum(['brand_name', 'generic_name']).optional().describe('Search by brand or generic name'),
    },
  },
  {
    name: 'market_analysis',
    title: 'Healthcare specialty market analysis by state',
    description: 'Healthcare specialty market analysis for a specific state. Returns provider density, competition metrics, and market opportunity data.',
    price: '$0.10',
    endpoint: '/agent/v1/market/analysis',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      state: z.string().describe('2-letter state code (e.g., "TX", "CA")'),
      specialty: z.string().describe('Medical specialty (e.g., "cardiology", "orthopedics")'),
    },
  },

  // --- Account & Billing (free — uses your API key) ---
  {
    name: 'account_status',
    title: 'Account status — credit balance and usage (free)',
    description: 'Check your MyMedi-AI account: current credit balance, USD equivalent, transaction count, recent transactions, and last activity. Free — never bills credits. Uses your X-API-Key.',
    price: 'free',
    auth: true,
    method: 'GET',
    endpoint: '/bot-marketplace/balance',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {},
  },
  {
    name: 'buy_credits',
    title: 'Buy credits — get a Stripe checkout link',
    description: 'Top up your MyMedi-AI credits. Creates a Stripe Checkout session and returns a checkoutUrl for you to open and complete payment in the browser — calling this tool charges nothing by itself. Specify amount (USD, min $1 = 1,000 credits) or package (starter $1, basic $5, standard $25, professional $100, enterprise $500). 1 credit = $0.001; credits are added automatically after checkout.',
    price: 'free',
    auth: true,
    endpoint: '/bot-marketplace/credits/purchase',
    // NOT read-only: creates a Stripe checkout session (no charge until the
    // user completes checkout in the browser; a new session per call).
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    schema: {
      amount: z.number().min(1).max(10000).optional().describe('USD amount to purchase (min $1 = 1,000 credits)'),
      package: z.enum(['starter', 'basic', 'standard', 'professional', 'enterprise']).optional().describe('Named package: starter $1/1k, basic $5/5k, standard $25/25k, professional $100/100k, enterprise $500/500k credits (alternative to amount)'),
    },
  },
];

export function getToolByName(name) {
  return MCP_TOOLS.find((t) => t.name === name);
}
