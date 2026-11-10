# @mymedi-ai/mcp-server

[![npm version](https://img.shields.io/npm/v/%40mymedi-ai%2Fmcp-server)](https://www.npmjs.com/package/@mymedi-ai/mcp-server)
[![license: MIT](https://img.shields.io/badge/license-MIT-teal)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-teal)](https://mymedi-ai.com/mcp-stream)

MCP server for DME billing and medical coding. Connect Claude, Cursor, VS Code or any MCP client to **23 tools** — code lookup across a database of 90K+ ICD-10-CM, CPT and HCPCS codes, DMEPOS fee schedules, Medicare prior-authorization and face-to-face list checks, denial-code guidance and pre-submission claim checks — plus five DME billing prompts and three dataset resources. Six tools work with no API key.

PHI-free by design: the tools take codes, modifiers, dates of service and de-identified text, never patient identifiers. Apart from drawing credits for paid calls, no tool changes anything except `buy_credits`, which opens a Stripe checkout session (nothing is charged until checkout is completed in the browser).

**Claude (web or desktop) users:** on Free, Pro and Max plans, open Customize → Connectors → **+ Add** → **Add custom connector**, give it a name and the URL `https://mymedi-ai.com/mcp-stream`, then **Add** → **Connect**. On Team and Enterprise plans an Owner adds it once under Organization settings → Connectors → **Add** → **Custom** → **Web**, and members then **Connect** it from Customize → Connectors. The endpoint is OAuth-protected: Claude registers itself and asks you to sign in to MyMedi-AI once, and the first connector sign-in comes with free starter credits. There is no API key to copy.

## Quick Start

Requires Node.js 20 or later.

### Install

```bash
claude mcp add mymedi-ai --env MCP_API_KEY=your-api-key -- npx -y @mymedi-ai/mcp-server
```

Leave out `--env MCP_API_KEY=…` to start with the six free tools. Other clients are under [Client setup](#client-setup).

### Get an API key (for the paid tools)

Registration is a POST request, not a web page:

```bash
curl -X POST https://mymedi-ai.com/bot-marketplace/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
# → { "apiKey": "...", "credits": ..., "quickStart": { ... } }
```

Set the returned `apiKey` as `MCP_API_KEY`. (`MYMEDI_API_KEY`, the name the registration response prints, is accepted too; `MCP_API_KEY` wins when both are set.) A new key comes with free starter credits; the `buy_credits` tool adds more.

### Or try a free endpoint

```bash
curl "https://mymedi-ai.com/agent/v1/demo?code=99213"
```

Returns basic code metadata, rate-limited to 60 requests per hour per IP.

## Free tools (no API key)

Install the server without `MCP_API_KEY` and these work immediately (60 requests per hour per IP):

| Tool | What it does |
|------|--------------|
| `pa_required_check` | Is a HCPCS code on the CMS Required Prior Authorization List (42 CFR 414.234) on a date of service; phased-in items by state; flags codes on the Probationary Prior Authorization List for newly enrolled suppliers |
| `denial_code_info` | DME denial code (CARC) explainer — meaning, common causes, fixes, appealability |
| `code_lookup_basic` | Basic code metadata — code, type, description, category, active status |
| `reimbursement_basic` | Medicare national PFS payment and DMEPOS fee-schedule ranges (rental/purchase) |
| `order_readiness_checklist` | Blank DMEPOS pre-delivery checklist — SWO elements, F2F/WOPD, prior authorization (42 CFR 410.38), probationary prior authorization for newly enrolled suppliers |
| `modifier_advisor` | DMEPOS billing-modifier guidance — KX/GA/GY/GZ, RR/NU/UE, capped-rental months, laterality |

The other 17 tools need an API key (or the connector sign-in): 15 are paid — per call, or per code for `code_lookup_batch`, `code_validate_batch` and `pa_exposure_report` — and `account_status` and `buy_credits` are free but need the key to identify the account.

## Client setup

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mymedi-ai": {
      "command": "npx",
      "args": ["-y", "@mymedi-ai/mcp-server"],
      "env": {
        "MCP_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mymedi-ai": {
      "command": "npx",
      "args": ["-y", "@mymedi-ai/mcp-server"],
      "env": { "MCP_API_KEY": "your-api-key" }
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "mymedi-ai": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@mymedi-ai/mcp-server"],
      "env": { "MCP_API_KEY": "your-api-key" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add mymedi-ai --env MCP_API_KEY=your-api-key -- npx -y @mymedi-ai/mcp-server
```

## Tools (23)

### Free (no API key)
| Tool | Description | Price |
|------|-------------|-------|
| `pa_required_check` | Medicare DMEPOS prior-auth required check (42 CFR 414.234) | free |
| `denial_code_info` | DME denial code (CARC) explainer | free |
| `code_lookup_basic` | Basic code metadata lookup | free |
| `reimbursement_basic` | Medicare national PFS payment + DMEPOS fee-schedule ranges | free |
| `order_readiness_checklist` | Blank DMEPOS pre-delivery checklist (SWO, F2F/WOPD, PA) | free |
| `modifier_advisor` | DMEPOS billing-modifier guidance (KX/GA/GY/GZ, RR/NU/UE, laterality) | free |

### Account (free — uses your sign-in or API key)
| Tool | Description | Price |
|------|-------------|-------|
| `account_status` | Credit balance, usage and recent transactions | free |
| `buy_credits` | Returns a Stripe checkout link to add credits; charges nothing by itself | free |

### Medical coding
| Tool | Description | Price |
|------|-------------|-------|
| `code_lookup` | Look up an ICD-10, CPT or HCPCS code; labeled DMEPOS fee schedule, optional state | $0.001 |
| `code_lookup_batch` | Up to 25 codes per call, per-item results; refunded when every code misses | $0.001/code |
| `code_suggest` | Code suggestions from a clinical description (term search, coverage ranking; refunded on no match) | $0.01 |
| `code_validate` | Is a code valid and active, optionally on a date of service | $0.005 |
| `code_validate_batch` | Up to 25 codes per call, per-item results | $0.005/code |
| `code_crossref` | Related codes across ICD-10, CPT and HCPCS | $0.02 |
| `code_reimbursement` | Medicare PFS rates: RVUs and estimated payment | $0.01 |
| `fee_schedule_lookup` | DMEPOS fee schedule — rental/purchase, rural/non-rural, by state | $0.01 |

### Prior auth and claims
| Tool | Description | Price |
|------|-------------|-------|
| `pa_predict` | Prior-auth approval rate from your organization's own decided PAs (10 or more), else the CMS list facts, refunded — never a made-up probability | $0.05 |
| `pa_status` | Status of a PA tracked in your MyMedi-AI web workspace (does not query payers) | $0.02 |
| `pa_exposure_report` | Map up to 100 HCPCS codes against the CMS PA and F2F/WOPD lists on a date of service, with documentation gates and denial-risk flags; pass a state for items phased in by state | $0.01/code |
| `claims_validate` | Pre-submission check of a claim's codes and date of service; does not assess medical necessity or prior authorization | $0.05 |
| `ner_extract` | ICD-10-CM, HCPCS Level II (with modifiers) and keyword-marked CPT codes found in de-identified text, each checked against the code sets, plus M/D/Y dates and a dose-unit flag; no drug names | $0.02 |
| `compliance_audit` | Audit of one DMEPOS order's documentation (SWO elements, F2F/WOPD, prior authorization) for its HCPCS code and date of service, from true/false facts — never identifiers; pass or fail per requirement with its citation, and a result that fails when any requirement fails | $0.25 |

### Providers
| Tool | Description | Price |
|------|-------------|-------|
| `provider_search` | NPI registry (NPPES) search by name, specialty or location, or one provider's record by NPI | $0.005 |

## Prompts

| Prompt | Arguments | What it does |
|--------|-----------|--------------|
| `decode-denial` | `code` (CARC, e.g. `CO-50`) | Decodes the denial with `denial_code_info`, then builds a fix/resubmit/appeal action plan |
| `order-readiness` | `code` (HCPCS, e.g. `E0466`) | Assembles the blank pre-delivery paperwork checklist with `order_readiness_checklist` |
| `scrub-claim` | `procedureCodes`, `diagnosisCodes?`, `dateOfService?` | Checks codes and date of service with `claims_validate` and the PA and F2F/WOPD lists with the free tools, then a prioritized fix list; asks for a missing diagnosis code or date, never for patient identifiers |
| `draft-appeal` | `code` (CARC), `procedureCode?` | Decodes the denial and outlines a redetermination letter with the documents to attach |
| `estimate-reimbursement` | `code` (HCPCS), `state?` | Pulls `fee_schedule_lookup` and explains rental vs purchase and rural vs non-rural |

## Resources

| Resource | URI | Contents |
|----------|-----|----------|
| PA Required List | `mymedi://datasets/pa-required-list` | CMS Required Prior Authorization List (42 CFR 414.234) with categories and nationwide-since dates |
| F2F + WOPD List | `mymedi://datasets/f2f-wopd-list` | CMS face-to-face / written-order-prior-to-delivery list (42 CFR 410.38(d)) plus the standard written order elements |
| Platform overview | `https://mymedi-ai.com/llms.txt` | What MyMedi-AI is, the tool catalog, pricing and integration paths (read from the public site; a short summary if it cannot be reached) |

## Credits and billing

- The per-tool price list is published as JSON at `https://mymedi-ai.com/bot-marketplace/credits/pricing`.
- 1 credit = $0.001. Paid tools cost from 1 credit (`code_lookup`) to 250 credits (`compliance_audit`) per call; `code_lookup_batch`, `code_validate_batch` and `pa_exposure_report` are priced per code. A failed call is refunded.
- Each successful paid call's result includes a `_billing` field: `{ "creditsSpent": …, "creditsRemaining": …, "priceUSD": … }`. (Over plain REST, without MCP, the same figures arrive as `X-Credits-Spent` / `X-Credits-Remaining` headers.)
- `account_status` shows the balance and recent transactions. `buy_credits` returns a Stripe checkout link — $1 buys 1,000 credits, packages run from $1 to $500 — and the credits arrive once checkout is completed.

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_API_KEY` | API key from registration; omit it to use only the free tools | — |
| `MYMEDI_API_KEY` | Accepted alias of `MCP_API_KEY` (`MCP_API_KEY` wins when both are set) | — |
| `MCP_API_BASE_URL` | API base URL | `https://mymedi-ai.com` |
| `MCP_CONNECTOR_TOKEN` | Shared-egress rate-limit token for hosted multi-user deployments (not needed for individual installs) | — |
| `MCP_HTTP` | `1` runs the HTTP mode, same as `--http` | — |
| `MCP_HOST` | Address the HTTP mode listens on | `127.0.0.1` |
| `MCP_PORT` | Port the HTTP mode listens on | `8080` |
| `MCP_HTTP_TOKEN` | Bearer token clients must send to the HTTP mode; required when `MCP_HOST` is not loopback; at least 32 characters | — |
| `MCP_ALLOWED_HOSTS` | Hostnames or addresses clients use to reach the HTTP mode (comma-separated); with `MCP_HOST=0.0.0.0`, include the LAN or Docker-host IPs | — |
| `MCP_ALLOWED_ORIGINS` | Browser origins allowed to call the HTTP mode (comma-separated, e.g. `https://app.example.com`) | none |
| `MCP_MAX_SESSIONS` | Most open HTTP sessions | `100` |
| `MCP_SESSION_IDLE_MS` | An HTTP session unused this long is closed | `1800000` (30 minutes) |

## HTTP mode (`--http`)

The same server can run over Streamable HTTP for clients that connect by URL:

```bash
MCP_API_KEY=your-api-key npx -y @mymedi-ai/mcp-server --http
# MCP HTTP server listening on http://127.0.0.1:8080/mcp
```

Every call through it spends the key in `MCP_API_KEY`, so the endpoint is guarded:

- **Loopback by default.** It listens on 127.0.0.1 unless `MCP_HOST` says otherwise.
- **A token off loopback.** With a non-loopback `MCP_HOST` (such as `0.0.0.0`) the server refuses to start unless `MCP_HTTP_TOKEN` is set — at least 32 characters, for example `openssl rand -hex 32`. Clients then send `Authorization: Bearer <token>`; anything else gets 401. A token can be set on loopback too.
- **Host check.** A request must name the server as `localhost`, `127.0.0.1`, `[::1]`, the `MCP_HOST` address, or a hostname or address in `MCP_ALLOWED_HOSTS`; any other `Host` gets 403. This stops DNS-rebinding pages. With `MCP_HOST=0.0.0.0` the server has no address of its own to match, so list every address clients use — the LAN IP, the Docker host's IP, a DNS name — in `MCP_ALLOWED_HOSTS`.
- **Origin check.** A request from a web page (it carries an `Origin` header) gets 403 unless that origin is in `MCP_ALLOWED_ORIGINS`, and only listed origins receive CORS headers. Desktop clients send no `Origin` and are unaffected.
- **Limits.** Bodies over 1 MiB get 413, a body that is not JSON gets a JSON-RPC parse error, sessions are capped (`MCP_MAX_SESSIONS`) and closed after `MCP_SESSION_IDLE_MS` without use, and an unknown session id gets 404 so the client starts a new session.

Serving other machines:

```bash
MCP_HOST=0.0.0.0 MCP_HTTP_TOKEN="$(openssl rand -hex 32)" MCP_ALLOWED_HOSTS=mcp.example.com,192.168.1.20 \
  MCP_API_KEY=your-api-key npx -y @mymedi-ai/mcp-server --http
```

Put TLS (a reverse proxy) in front of it when traffic leaves the machine: the token travels in a header.

## Changes in 2.1.0

`order_readiness_checklist` and `reimbursement_basic` return a `competitiveBidding` block for an item in the current round of the Medicare DMEPOS Competitive Bidding Program (Round 2028): its product category, the modifier that places it there, the bidding dates and whether contracts are in effect. From January 1, 2028 the single payment amount replaces the fee schedule amount for those items, and `reimbursement_basic` says so.

`order_readiness_checklist` returns a `replacementItem` block for items with a face-to-face requirement, and `compliance_audit` takes a `replacementItem` fact: from January 4, 2027 an item that replaces one with the same HCPCS code needs no new face-to-face encounter (42 CFR 410.38(d)(2)(iii)); a new order is still required.

`modifier_advisor` returns `policyModifiers` for glucose monitor, continuous glucose monitor (CGM) and supply codes: the KX/KS, CG and KF rules of the DME MAC Glucose Monitor policy article.

## Changes in 2.0.0

**Breaking: nine tools are retired.** `drug_lookup`, `drug_interactions`, `drug_rxnorm`, `drug_enrich`, `trials_search`, `disease_surveillance`, `market_analysis`, `provider_payments` and `provider_enrich` were not DME billing and are gone from the server, the API and this package; their endpoints answer 404. The catalog is 23 tools: 6 free, 15 paid, 2 account.

`provider_search` takes an optional `npi` and returns that provider's NPPES record, for checking the practitioner named on an order. `pa_required_check` and `order_readiness_checklist` return a `probationaryPa` block for codes on the CMS Probationary Prior Authorization List, which applies only to newly enrolled suppliers; `paRequired` still answers for an established supplier.

## Changes in 1.7.10

No configuration changes. Every tool repeats its title in `annotations.title`, where the Claude Connectors Directory reads it. `provider_search` (`taxonomy`) and `market_analysis` (`specialty`) describe the specialty they take as an NPPES (NUCC) taxonomy description, such as "Pulmonary Disease" or "Orthopaedic Surgery", where a trailing `*` matches a prefix; the API refuses a specialty NPPES cannot match (a 400, at no cost) instead of reporting zero providers.

## Changes in 1.7.9

No configuration changes. Tool descriptions say what each tool returns and when it applies; none instructs the model or names another tool. `drug_enrich` and `pa_predict` describe what the API now returns: the `drug_enrich` summary restates the label (the therapeutic class and the indications it lists) and no longer names alternative therapies or adds clinical notes, so the tool gives no treatment advice; the `pa_predict` recommendation states the CMS requirement, whatever the approval rate. Neither makes a coverage or prior-authorization determination.

## Changes in 1.7.8

No configuration changes, but update to use `compliance_audit`: it now takes an order, and the API refuses the free-form payload that 1.7.7 and earlier send (a 400, at no cost).

Three paid tools now do what their descriptions say. `compliance_audit` audits one DMEPOS order's documentation — the standard written order elements, the face-to-face encounter and written order before delivery, and prior authorization — for the order's HCPCS code and date of service (now required), from true/false facts that never carry identifiers; each requirement comes back pass or fail with its citation, and the result fails when one does. It no longer runs the identifier pattern checks it used to; `auditType` is optional and takes only `dme_order`. `drug_interactions` returns the number of FAERS reports naming the drugs together and, for each reaction, a proportional reporting ratio with a 95% interval against each drug alone, in place of a grade by report volume; drug names are normalized to what openFDA can search (accents, curly apostrophes, ® and ™, "+" and "&", and strengths such as 0.5% or 1:100,000), and a name with fewer than two letters or digits, or with quotes or other symbols, is refused. `ner_extract` reads whole ICD-10-CM codes (with extensions), HCPCS Level II codes with their modifiers, and CPT codes only where a keyword marks them, each checked against the code sets; `entityTypes` adds `HCPCS_CODE`.

The code tools rank and date their answers. `code_suggest` ranks by relevance: it reads common abbreviations and alternate forms (CPAP, OSA, COPD, IG for immune globulin, type 2) and a typed side, sex or "without", lists the best code for each separate thing a description names first, and leaves weak matches out instead of padding the list. `code_crossref` returns curated `linkedCodes` (the DME code family, and links across code systems that cite their CMS source) and `crossReferences` ranked by `relevanceScore`, weak matches left out; an answer with no related codes is refunded. `code_validate` and `code_validate_batch` take `dateOfService` (or `date_of_service`) at the top level as well as in `context`, refuse a date that is not YYYY-MM-DD or two dates that differ, and report `asOf`, the date a code was judged for. `claims_validate` states what it checks — codes active on the date of service, well-formed modifiers, a date not in the future — and that it applies no NCCI edits.

## Changes in 1.7.7

No configuration changes. Tool descriptions now match what the API returns: `drug_enrich` lists the label fields and the labelled LLM summary it returns, and says a failed call is refunded (the API no longer returns a model-made prior-auth likelihood or cost tier); `pa_predict` says its approval rate comes only from your organization's own decided prior authorizations and that `payerId` is a payer category; `ner_extract` names the patterns it matches (it extracts no drug names), and its `entityTypes` filter now applies; `code_suggest` takes up to 500 characters (the search never read more; longer text is now refused instead of silently cut); data sources are named without licence claims. The support address is info@mymedi-ai.com.

## Upgrading to 1.7.6

**Breaking for remote `--http` deployments only.** Up to 1.7.5 the HTTP mode listened on every interface, served any caller without a token and sent `Access-Control-Allow-Origin: *`. From 1.7.6 it listens on 127.0.0.1; to serve other machines set `MCP_HOST`, `MCP_HTTP_TOKEN` (required off loopback) and `MCP_ALLOWED_HOSTS` with every hostname or address clients use (with `MCP_HOST=0.0.0.0` that includes LAN and Docker-host IPs); browser-based clients also need `MCP_ALLOWED_ORIGINS`. An unknown session id now gets 404 instead of 400. stdio installs (Claude Desktop, Cursor, VS Code, Claude Code) are unaffected.

1.7.6 also requires Node.js 20 or later (Node 18 is past end of life, and the SDK's dependencies need 20). Also in 1.7.6: the server sends its instructions at initialize; `scrub-claim` takes an optional `dateOfService` and no longer asks about medical necessity; `MYMEDI_API_KEY` is accepted as an alias of `MCP_API_KEY`; and a paid call without a key explains how to register.

## SDK

For programmatic use without MCP, install the SDK:

```bash
npm install @mymedi-ai/sdk
```

```javascript
import { MyMediAI } from '@mymedi-ai/sdk';

const client = new MyMediAI({ apiKey: 'your-api-key' });
const result = await client.codeLookup('M79.3');
```

## Data sources

- **ICD-10-CM and HCPCS Level II**: CMS and CDC code sets
- **CPT®**: from the CMS physician fee schedule (RVU) files. CPT® is a registered trademark of the American Medical Association (AMA); CPT codes and descriptions are AMA copyright.
- **Fee schedules and lists**: CMS DMEPOS fee schedule, Medicare physician fee schedule (RVU), the Required Prior Authorization List and the F2F/WOPD list
- **Providers**: CMS NPI registry (NPPES)

## Troubleshooting

- **402 "payment_required"** — without an API key, a paid tool answers with the registration request to send (see [Get an API key](#get-an-api-key-for-the-paid-tools)); with a key, it means the credits ran out: call `buy_credits`. The six free tools never need a key.
- **"invalid_api_key"** — the key in `MCP_API_KEY` (or `MYMEDI_API_KEY`) was not recognised: check it for a typo or a missing part and restart the server, or register a new key.
- **429 on free tools** — free endpoints allow 60 requests per hour per IP. Wait, or use a key and the paid equivalents.
- **Connector won't connect** — the hosted endpoint is `https://mymedi-ai.com/mcp-stream` (Streamable HTTP) and it is OAuth-protected. An unauthenticated request returns `{"error":"unauthorized","error_description":"OAuth required"}` — that is the endpoint working, not a fault, and a bare `inspector --cli … --method tools/list` shows it because it holds no token. To confirm the service is up, read the discovery document: `curl -s https://mymedi-ai.com/.well-known/oauth-protected-resource` names `.../mcp-stream` as the protected resource. Claude performs dynamic client registration and the sign-in itself.
- **`--http` answers 401, 403 or refuses to start** — see [HTTP mode](#http-mode---http): send the bearer token, add the hostname to `MCP_ALLOWED_HOSTS` or the web origin to `MCP_ALLOWED_ORIGINS`, and set `MCP_HTTP_TOKEN` before listening off loopback.
- **Code not found** — lookups expect bare codes (`E1390`, `99213`, `M79.3`). Denial codes accept `CO-50`, `co50` or `50`.
- **Data currency** — reference data follows CMS release cycles; prior-authorization and F2F/WOPD answers carry the list version they were checked against.
- **Still stuck?** Email info@mymedi-ai.com or open an issue at https://github.com/MyMedi-AI/mymedi-ai-mcp-server/issues.

## Links

- [API discovery (JSON)](https://mymedi-ai.com/agent/v1/discovery)
- [Free demo lookup](https://mymedi-ai.com/agent/v1/demo?code=99213)
- [Price list (JSON)](https://mymedi-ai.com/bot-marketplace/credits/pricing)
- [Credits for a web or connector account](https://mymedi-ai.com/account/credits)
- API key registration: `POST https://mymedi-ai.com/bot-marketplace/register` (a request, not a page)
- Hosted connector: `https://mymedi-ai.com/mcp-stream`

## License

MIT
