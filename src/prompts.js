/**
 * MCP prompts for the npm server, as plain data: a zod argument shape and a
 * message builder per prompt, with no SDK import. index.js registers them.
 *
 * The hosted connector serves the same five prompts from its own copy
 * (server/mcp/promptsResources.js in the MyMedi-AI app repo, explicit
 * patterns instead of zod); that repo's prompts.parity.test.js loads this
 * file to hold both copies to the same names, arguments, accepted inputs and
 * message text.
 */
import { z } from 'zod';

// Every prompt argument is a strictly-patterned medical code — a CARC denial
// code, a HCPCS/CPT procedure code, an ICD-10 diagnosis, a state — or a
// YYYY-MM-DD date of service. None of them is free text, so the accepted shape is narrow enough to state exactly.
// Pinning it rejects a malformed code before it reaches a template (a typo'd
// code otherwise sails through and yields a confidently wrong answer), and
// leaves the interpolated value inert by construction: a value matching these
// patterns cannot carry a sentence. The SDK surfaces each `pattern` in
// prompts/list, so callers see the contract too.
const CARC_CODE = /^(?:CO|PR|OA|PI|CR)?-?[A-Z]?\d{1,3}$/i;
const HCPCS_CODE = /^[A-Z]\d{4}(?:-[A-Z0-9]{2})?$/i;
const PROCEDURE_CODE = /^(?:[A-Z]\d{4}|\d{5})(?:-[A-Z0-9]{2})?$/i;
const ICD10_CODE = /^[A-Z]\d{2}(?:\.[A-Z0-9]{1,4})?$/i;
const STATE_CODE = /^[A-Z]{2}$/i;
const DATE_OF_SERVICE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

const codeArg = (pattern, label) =>
  z.string().trim().regex(pattern, `Must be a valid ${label}`);

const codeListArg = (pattern, label) =>
  z
    .string()
    .trim()
    .refine(
      (v) => v.split(',').every((c) => pattern.test(c.trim())),
      `Must be a comma-separated list of valid ${label}s`
    );

// An optional argument sent blank ("" is what a client sends for a field the
// user left empty) counts as absent instead of failing its pattern — the
// hosted copy's rule too.
const optionalArg = (schema) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

const userText = (text) => [{ role: 'user', content: { type: 'text', text } }];

// scrub-claim: claims_validate checks that the codes exist and are active on
// the date of service, that modifiers are well-formed and known, and that the
// date is not in the future. It needs the date and at least one diagnosis
// code, and it assesses neither medical necessity nor prior authorization —
// so the prompt asks for what is missing, sends the list checks to the free
// tools, and says what the checks cannot establish.
const scrubClaimText = ({ procedureCodes, diagnosisCodes, dateOfService }) => {
  const missing = [
    ...(diagnosisCodes ? [] : ['at least one ICD-10-CM diagnosis code']),
    ...(dateOfService ? [] : ['the date of service (YYYY-MM-DD)']),
  ];
  return `I am about to submit a DME claim with procedure code(s) ${procedureCodes}`
    + `${diagnosisCodes ? `, diagnosis code(s) ${diagnosisCodes}` : ''}`
    + `${dateOfService ? ` and date of service ${dateOfService}` : ''}. `
    + `${missing.length ? `claims_validate needs ${missing.join(' and ')}: ask me for ${missing.length > 1 ? 'them' : 'it'} before calling it. ` : ''}`
    + 'Use the claims_validate tool to check the codes and the date, then give me: (1) each code that is not valid or not active on the date of service, and each malformed or unrecognised modifier, with the fix the tool suggests; (2) for each HCPCS code, whether it is on the CMS prior-authorization list or the face-to-face / written-order-prior-to-delivery list, checked with the free pa_required_check or order_readiness_checklist tool for that date of service; and (3) a prioritized pre-submission checklist. These checks cover code and date validity and those CMS lists only: say plainly that they do not establish medical necessity, coverage or payment. Ask only for codes, modifiers and the date of service — never ask for or send patient names, dates of birth, member IDs or any other patient identifier (PHI-free).';
};

export const MCP_PROMPTS = [
  {
    name: 'decode-denial',
    title: 'Decode a DME claim denial',
    description: 'Explain a CARC denial code and build an action plan to fix, resubmit, or appeal the claim.',
    argsSchema: { code: codeArg(CARC_CODE, 'CARC denial code').describe('CARC denial code (e.g., "CO-50")') },
    buildMessages: ({ code }) => userText(
      `A DME claim came back with denial code ${code}. Use the denial_code_info tool to decode it, then give me: (1) what this denial means in plain language, (2) the most likely root causes for a DME supplier, (3) concrete fix-and-resubmit steps in priority order, and (4) whether an appeal is worthwhile. Do not include any patient identifiers in tool calls.`
    ),
  },
  {
    name: 'order-readiness',
    title: 'DMEPOS order-readiness review',
    description: 'Assemble the blank pre-delivery paperwork checklist for a HCPCS code: SWO elements, F2F/WOPD, and prior authorization.',
    argsSchema: { code: codeArg(HCPCS_CODE, 'HCPCS Level II code').describe('HCPCS Level II code (e.g., "E0466")') },
    buildMessages: ({ code }) => userText(
      `I am preparing a Medicare DMEPOS order for HCPCS code ${code}. Use the order_readiness_checklist tool to pull every documentation requirement, then present a blank pre-delivery checklist: the standard written order elements, any face-to-face encounter / WOPD requirement with its timing rule, and whether prior authorization must be affirmed before delivery. Flag the items suppliers most often miss. Keep it PHI-free — requirement definitions only, no patient data.`
    ),
  },
  {
    name: 'scrub-claim',
    title: 'Scrub a DME claim before submission',
    description: 'Check a draft DME claim\'s codes and date of service with claims_validate, check prior-authorization and F2F/WOPD list requirements with the free tools, and turn the findings into a prioritized pre-submission fix list.',
    argsSchema: {
      procedureCodes: codeListArg(PROCEDURE_CODE, 'HCPCS/CPT procedure code').describe('HCPCS/CPT procedure codes on the claim, comma-separated (e.g., "E0601,A7030")'),
      diagnosisCodes: optionalArg(codeListArg(ICD10_CODE, 'ICD-10 diagnosis code')).describe('ICD-10-CM diagnosis codes, comma-separated (e.g., "G47.33"); claims_validate needs at least one'),
      dateOfService: optionalArg(codeArg(DATE_OF_SERVICE, 'date of service (YYYY-MM-DD)')).describe('Date of service, YYYY-MM-DD (e.g., "2026-10-01"); claims_validate needs it'),
    },
    buildMessages: (args) => userText(scrubClaimText(args)),
  },
  {
    name: 'draft-appeal',
    title: 'Draft a DME denial appeal',
    description: 'Decode a denial code and structure a redetermination/appeal letter outline with the supporting documentation to attach.',
    argsSchema: {
      code: codeArg(CARC_CODE, 'CARC denial code').describe('CARC denial code received (e.g., "CO-50")'),
      procedureCode: optionalArg(codeArg(HCPCS_CODE, 'HCPCS code')).describe('HCPCS code that was denied (e.g., "K0823")'),
    },
    buildMessages: ({ code, procedureCode }) => userText(
      `A DME claim${procedureCode ? ` for HCPCS ${procedureCode}` : ''} was denied with code ${code}. Use the denial_code_info tool to decode it${procedureCode ? ', and order_readiness_checklist to confirm the documentation the payer expects for this item' : ''}. Then draft the structure of a Medicare redetermination/appeal: (1) the specific reason for denial in plain language, (2) whether it is appealable and the deadline, (3) a paragraph-by-paragraph appeal-letter outline, and (4) the exact supporting documents to attach. Provide a reusable template with placeholders — insert NO patient identifiers (PHI-free).`
    ),
  },
  {
    name: 'estimate-reimbursement',
    title: 'Estimate DME reimbursement for a code',
    description: 'Pull the DMEPOS fee schedule for a code and state and explain the rental-vs-purchase and rural-vs-non-rural options.',
    argsSchema: {
      code: codeArg(HCPCS_CODE, 'DMEPOS HCPCS code').describe('DMEPOS HCPCS code (e.g., "E0601")'),
      state: optionalArg(codeArg(STATE_CODE, '2-letter state code')).describe('2-letter state (e.g., "TX")'),
    },
    buildMessages: ({ code, state }) => userText(
      `Estimate Medicare reimbursement for HCPCS ${code}${state ? ` in ${state}` : ''}. Use the fee_schedule_lookup tool${state ? ` with state ${state}` : ''} to pull the DMEPOS rates, then explain: (1) the monthly rental (RR) vs purchase (NU new / UE used) amounts, (2) the non-rural vs rural difference and which applies, (3) any capped-rental implications, and (4) how the national range compares if no state was given. Note that these are Medicare allowables, not guaranteed payment. Requirement/rate data only — PHI-free.`
    ),
  },
];
