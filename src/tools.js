/**
 * MCP Tool Definitions for MyMedi-AI Healthcare Agent API
 * 24 tools: 4 free no-auth + 20 x402-protected REST endpoints mapped to MCP tool format.
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
  // --- Free, no API key (GET endpoints, rate-limited 10/hr/IP server-side) ---
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
    description: 'Look up the Medicare national payment rate for a code. Returns national PFS facility and non-facility payment computed from CMS RVU values and the conversion factor. Free, no API key required.',
    price: 'free',
    auth: false,
    method: 'GET',
    endpoint: '/agent/v1/codes/reimbursement-basic',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      code: z.string().describe('Medical code (e.g., "97110")'),
    },
  },

  // --- Medical Coding ---
  {
    name: 'code_lookup',
    title: 'Medical code lookup (ICD-10 / CPT / HCPCS)',
    description: 'Look up medical codes (ICD-10, CPT, HCPCS) by code string. Returns description, category, active status, and related codes.',
    price: '$0.001',
    endpoint: '/agent/v1/codes/lookup',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      code: z.string().describe('Medical code to look up (e.g., "M79.3", "99213", "E0601")'),
      codeType: z.enum(['icd10', 'cpt', 'hcpcs']).optional().describe('Code system (auto-detected if omitted)'),
    },
  },
  {
    name: 'code_suggest',
    title: 'AI medical code suggestions from clinical text',
    description: 'Get AI-powered medical code suggestions from a clinical description. Returns ranked code suggestions with relevance scores.',
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

  // --- Prior Authorization ---
  {
    name: 'pa_predict',
    title: 'Prior-auth approval likelihood predictor',
    description: 'Predict prior authorization approval probability for a procedure. Returns approval likelihood (0-1), confidence level, estimated processing days, and contributing factors.',
    price: '$0.05',
    endpoint: '/agent/v1/pa/predict',
    annotations: READ_ONLY_ANNOTATIONS,
    schema: {
      procedureCode: z.string().describe('CPT/HCPCS procedure code'),
      diagnosisCodes: z.array(z.string()).optional().describe('Supporting ICD-10 diagnosis codes'),
      payerId: z.string().optional().describe('Insurance payer ID'),
      patientAge: z.number().optional().describe('Patient age in years'),
      patientGender: z.enum(['M', 'F', 'O']).optional(),
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
];

export function getToolByName(name) {
  return MCP_TOOLS.find((t) => t.name === name);
}
