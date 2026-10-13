# @mymedi-ai/mcp-server

[![npm version](https://img.shields.io/npm/v/%40mymedi-ai%2Fmcp-server)](https://www.npmjs.com/package/@mymedi-ai/mcp-server)
[![license: MIT](https://img.shields.io/badge/license-MIT-teal)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-teal)](https://mymedi-ai.com/mcp-stream)

MCP server for DME billing and medical coding. Connect Claude, Cursor, VS Code or any MCP client to **32 tools** — code lookup across a database of 90K+ ICD-10-CM, CPT and HCPCS codes, DMEPOS fee schedules, Medicare prior-authorization and face-to-face list checks, denial-code guidance and pre-submission claim checks — plus five DME billing prompts and three dataset resources. Six tools work with no API key.

PHI-free by design: the tools take codes, modifiers, dates of service and de-identified text, never patient identifiers. Apart from drawing credits for paid calls, no tool changes anything except `buy_credits`, which opens a Stripe checkout session (nothing is charged until checkout is completed in the browser).

**Claude (web or desktop) users:** Settings → Connectors → **Add custom connector** → paste `https://mymedi-ai.com/mcp-stream`. The endpoint is OAuth-protected: Claude registers itself and asks you to sign in to MyMedi-AI once, and the first connector sign-in comes with free starter credits. There is no API key to copy.

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
| `pa_required_check` | Is a HCPCS code on the CMS Required Prior Authorization List (42 CFR 414.234) on a date of service; phased-in items by state |
| `denial_code_info` | DME denial code (CARC) explainer — meaning, common causes, fixes, appealability |
| `code_lookup_basic` | Basic code metadata — code, type, description, category, active status |
| `reimbursement_basic` | Medicare national PFS payment and DMEPOS fee-schedule ranges (rental/purchase) |
| `order_readiness_checklist` | Blank DMEPOS pre-delivery checklist — SWO elements, F2F/WOPD, prior authorization (42 CFR 410.38) |
| `modifier_advisor` | DMEPOS billing-modifier guidance — KX/GA/GY/GZ, RR/NU/UE, capped-rental months, laterality |

The other 26 tools need an API key (or the connector sign-in): 24 are paid per call, and `account_status` and `buy_credits` are free but need the key to identify the account.

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

## Tools (32)

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
| `pa_predict` | Prior-auth approval rate from a real cohort of decided PAs, else the CMS list facts — never a made-up probability | $0.05 |
| `pa_status` | Status of a PA tracked in your MyMedi-AI web workspace (does not query payers) | $0.02 |
| `pa_exposure_report` | Map up to 100 HCPCS codes against the CMS PA and F2F/WOPD lists on a date of service, with documentation gates and denial-risk flags; pass a state for items phased in by state | $0.01/code |
| `claims_validate` | Pre-submission check of a claim's codes and date of service; does not assess medical necessity or prior authorization | $0.05 |
| `ner_extract` | Codes, dates and drug names already present in de-identified text (pattern extraction) | $0.02 |
| `compliance_audit` | Pattern scan of a text payload for SSN, MRN and date-of-birth formats — screening, not a compliance audit | $0.25 |

### Drug data
| Tool | Description | Price |
|------|-------------|-------|
| `drug_lookup` | OpenFDA drug label and adverse-event data | $0.01 |
| `drug_interactions` | Drug-drug signals from FDA adverse-event co-reports (FAERS) | $0.03 |
| `drug_rxnorm` | Normalize a drug name with NIH RxNorm (RxCUI, term type) | $0.02 |
| `drug_enrich` | OpenFDA drug data plus an LLM-generated summary | $0.03 |

### Providers and market
| Tool | Description | Price |
|------|-------------|-------|
| `provider_search` | NPI registry (NPPES) search by name, specialty or location | $0.005 |
| `provider_enrich` | NPPES record for an NPI plus a labelled LLM estimate of specialty demand, network gaps and referral categories | $0.05 |
| `provider_payments` | Industry payments to a physician (CMS Open Payments) | $0.02 |
| `market_analysis` | NPPES provider count for a specialty and state (a floor; one query returns at most 200) plus a labelled LLM estimate of demand and opportunities | $0.10 |

### Clinical and public health
| Tool | Description | Price |
|------|-------------|-------|
| `trials_search` | Clinical trials (ClinicalTrials.gov) | $0.03 |
| `disease_surveillance` | Notifiable-disease case counts (CDC NNDSS) | $0.02 |

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
- **Providers**: CMS NPI registry (NPPES) and CMS Open Payments
- **Drugs**: openFDA (labels, adverse events) and NIH RxNorm
- **Clinical and public health**: ClinicalTrials.gov and CDC NNDSS

## Troubleshooting

- **402 "payment_required"** — without an API key, a paid tool answers with the registration request to send (see [Get an API key](#get-an-api-key-for-the-paid-tools)); with a key, it means the credits ran out: call `buy_credits`. The six free tools never need a key.
- **"invalid_api_key"** — the key in `MCP_API_KEY` (or `MYMEDI_API_KEY`) was not recognised: check it for a typo or a missing part and restart the server, or register a new key.
- **429 on free tools** — free endpoints allow 60 requests per hour per IP. Wait, or use a key and the paid equivalents.
- **Connector won't connect** — the hosted endpoint is `https://mymedi-ai.com/mcp-stream` (Streamable HTTP) and it is OAuth-protected. An unauthenticated request returns `{"error":"unauthorized","error_description":"OAuth required"}` — that is the endpoint working, not a fault, and a bare `inspector --cli … --method tools/list` shows it because it holds no token. To confirm the service is up, read the discovery document: `curl -s https://mymedi-ai.com/.well-known/oauth-protected-resource` names `.../mcp-stream` as the protected resource. Claude performs dynamic client registration and the sign-in itself.
- **`--http` answers 401, 403 or refuses to start** — see [HTTP mode](#http-mode---http): send the bearer token, add the hostname to `MCP_ALLOWED_HOSTS` or the web origin to `MCP_ALLOWED_ORIGINS`, and set `MCP_HTTP_TOKEN` before listening off loopback.
- **Code not found** — lookups expect bare codes (`E1390`, `99213`, `M79.3`). Denial codes accept `CO-50`, `co50` or `50`.
- **Data currency** — reference data follows CMS release cycles; prior-authorization and F2F/WOPD answers carry the list version they were checked against.
- **Still stuck?** Email support@mymedi-ai.com or open an issue at https://github.com/MyMedi-AI/mymedi-ai-mcp-server/issues.

## Links

- [API discovery (JSON)](https://mymedi-ai.com/agent/v1/discovery)
- [Free demo lookup](https://mymedi-ai.com/agent/v1/demo?code=99213)
- [Price list (JSON)](https://mymedi-ai.com/bot-marketplace/credits/pricing)
- [Credits for a web or connector account](https://mymedi-ai.com/account/credits)
- API key registration: `POST https://mymedi-ai.com/bot-marketplace/register` (a request, not a page)
- Hosted connector: `https://mymedi-ai.com/mcp-stream`

## License

MIT
