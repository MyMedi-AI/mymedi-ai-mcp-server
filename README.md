# @mymedi-ai/mcp-server

[![npm version](https://img.shields.io/npm/v/%40mymedi-ai%2Fmcp-server)](https://www.npmjs.com/package/@mymedi-ai/mcp-server)
[![license: MIT](https://img.shields.io/badge/license-MIT-teal)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-teal)](https://mymedi-ai.com/mcp-stream)

MCP server for healthcare AI. Connect Claude, Cursor, VS Code, or any MCP client to **25 medical billing + clinical intelligence tools** backed by 81K+ codes and 7 free government data sources — plus denial-decoding prompts and CMS dataset resources. Five tools work with no API key at all, and everything is read-only and PHI-free by design.

**Claude (web or desktop) users:** Settings → Connectors → **Add custom connector** → paste `https://mymedi-ai.com/mcp-stream` — no authentication, tools work immediately.

## Quick Start

Two ways to pay — pick either:

### Option A: Register for credits (100 free)

```bash
curl -X POST https://mymedi-ai.com/bot-marketplace/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
# → { apiKey, credits: 100 }
```

### Option B: Anonymous per-call USDC (no signup)

Send USDC on Base to the treasury wallet and include the signed payment in `X-402-Payment` header. True agent-to-agent commerce. See [`/agent/v1/pricing`](https://mymedi-ai.com/agent/v1/pricing) for details.

### Or try free

```bash
curl "https://mymedi-ai.com/agent/v1/demo?code=99213"
```

Returns basic code metadata (60/hour rate-limited). Paid tier unlocks RVU, Medicare reimbursement (PFS + OPPS), crosswalks, and AI features.

## Works without an API key

Five tools are free and need no API key — install the server with no `MCP_API_KEY` and they work immediately (rate-limited 60/hour/IP):

| Tool | Description |
|------|-------------|
| `pa_required_check` | Medicare DMEPOS prior-auth required check — CMS Required Prior Authorization List (42 CFR 414.234) |
| `denial_code_info` | DME denial code (CARC) explainer — meaning, common causes, fixes, appealability |
| `code_lookup_basic` | Basic medical code lookup — code, type, description, category, active status |
| `reimbursement_basic` | Medicare national PFS payment + DMEPOS fee-schedule ranges (rental/purchase) |
| `order_readiness_checklist` | Blank DMEPOS pre-delivery checklist — SWO elements, F2F/WOPD, prior auth (42 CFR 410.38) |

The other 20 paid tools need an API key from `POST /bot-marketplace/register` (100 starter credits).

## Client Setup

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

### Cursor / VS Code

Add to MCP settings:

```json
{
  "mymedi-ai": {
    "command": "npx",
    "args": ["-y", "@mymedi-ai/mcp-server"],
    "env": {
      "MCP_API_KEY": "your-api-key"
    }
  }
}
```

### Claude Code

```bash
claude mcp add mymedi-ai -- npx -y @mymedi-ai/mcp-server
```

## Tools (25)

### Free (no API key)
| Tool | Description | Price |
|------|-------------|-------|
| `pa_required_check` | Medicare DMEPOS prior-auth required check (42 CFR 414.234) | free |
| `denial_code_info` | DME denial code (CARC) explainer | free |
| `code_lookup_basic` | Basic code metadata lookup | free |
| `reimbursement_basic` | Medicare national PFS payment + DMEPOS fee-schedule ranges | free |
| `order_readiness_checklist` | Blank DMEPOS pre-delivery checklist (SWO, F2F/WOPD, PA) | free |

### Medical Coding
| Tool | Description | Price |
|------|-------------|-------|
| `code_lookup` | Look up ICD-10, CPT, HCPCS codes (81K+ codes) | $0.001 |
| `code_suggest` | AI code suggestions from clinical text | $0.01 |
| `code_validate` | Validate code correctness and status | $0.005 |
| `code_crossref` | Cross-reference codes across ICD-10/CPT/HCPCS | $0.02 |
| `code_reimbursement` | Medicare PFS + OPPS reimbursement rates (RVU, $) | $0.01 |

### Prior Auth & Claims
| Tool | Description | Price |
|------|-------------|-------|
| `pa_predict` | Prior auth approval prediction (0–1) | $0.05 |
| `pa_status` | Check prior auth status | $0.02 |
| `claims_validate` | Pre-submission claims validation | $0.05 |
| `ner_extract` | Extract medical entities from clinical text | $0.02 |
| `compliance_audit` | HIPAA compliance audit | $0.25 |

### Drug Intelligence
| Tool | Description | Price |
|------|-------------|-------|
| `drug_lookup` | OpenFDA drug info + adverse events | $0.01 |
| `drug_interactions` | FDA co-reported adverse event signals | $0.03 |
| `drug_rxnorm` | NIH RxNorm + clinical interactions | $0.02 |
| `drug_enrich` | AI-enriched drug intelligence | $0.03 |

### Providers & Market
| Tool | Description | Price |
|------|-------------|-------|
| `provider_search` | NPI provider directory search | $0.005 |
| `provider_enrich` | AI-enriched provider intelligence | $0.05 |
| `provider_payments` | Sunshine Act physician payments (CMS Open Payments) | $0.02 |
| `market_analysis` | Specialty market analysis by state | $0.10 |

### Clinical & Public Health
| Tool | Description | Price |
|------|-------------|-------|
| `trials_search` | Active clinical trials (ClinicalTrials.gov) | $0.03 |
| `disease_surveillance` | CDC NNDSS case counts + trends | $0.02 |

## Prompts

| Prompt | Arguments | What it does |
|--------|-----------|--------------|
| `decode-denial` | `code` (CARC, e.g. `CO-50`) | Decodes the denial via `denial_code_info`, then builds a fix/resubmit/appeal action plan |
| `order-readiness` | `code` (HCPCS, e.g. `E0466`) | Assembles the blank pre-delivery paperwork checklist via `order_readiness_checklist` |

## Resources

| Resource | URI | Contents |
|----------|-----|----------|
| PA Required List | `mymedi://datasets/pa-required-list` | Full CMS Required Prior Authorization List (42 CFR 414.234) with categories and effective dates |
| F2F + WOPD List | `mymedi://datasets/f2f-wopd-list` | Full CMS face-to-face/WOPD list (42 CFR 410.38(d)) plus the universal SWO elements |
| Platform overview | `https://mymedi-ai.com/llms.txt` | What MyMedi-AI is, tool catalog, pricing, integration paths |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_API_KEY` | API key from registration (omit for free tools / anonymous USDC) | — |
| `MCP_API_BASE_URL` | API base URL | `https://mymedi-ai.com` |
| `MCP_CONNECTOR_TOKEN` | Shared-egress rate-limit token for hosted multi-user deployments (not needed for individual installs) | — |

## Payment

- **Free tier**: 100 starter credits on registration ($0.10 of usage — enough to run `pa_predict` once and sample the cheap tiers)
- **Credit rate**: $0.001 per credit (1 credit = 1 cheapest call)
- **x402 USDC**: Pay per call on Base chain — no signup, agent-native commerce
- **Stripe**: Credit packages at [mymedi-ai.com/bot-marketplace/credits/pricing](https://mymedi-ai.com/bot-marketplace/credits/pricing)
- **USDC deposit**: Send to treasury wallet and redeem for credits

## Credit Balance Headers

Every paid response includes:

| Header | Meaning |
|--------|---------|
| `X-Credits-Remaining` | Balance after this call |
| `X-Credits-Spent` | Credits this call consumed |
| `X-Credits-Warning` | `low` (<50), `critical` (<10), `depleted` (0) |
| `X-Credits-Action-Required` | `top-up` or `top-up-soon` when balance is tight |

Your SDK/agent can watch for these to trigger auto-top-up.

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

## Data Sources

All 7 license-free government sources:

- **ICD-10 / HCPCS / CPT**: CMS PFS RVU 2026 (public domain)
- **NPI provider directory**: CMS (public domain)
- **OpenFDA**: drug labels, adverse events, interactions
- **RxNorm**: NIH normalized drug terminology
- **ClinicalTrials.gov**: active clinical trials
- **CMS Open Payments**: Sunshine Act physician payments
- **CDC NNDSS**: notifiable disease surveillance

## Troubleshooting

- **"Payment required" / 402 responses** — the tool you called is pay-per-call and no API key is configured. Register a free key (100 starter credits): `curl -X POST https://mymedi-ai.com/bot-marketplace/register -H "Content-Type: application/json" -d '{"name":"your-agent"}'`, then set `MCP_API_KEY`. The five free tools never need a key.
- **429 / rate-limited on free tools** — free endpoints allow 60 requests/hour per IP. Wait, or register a key and use the paid equivalents.
- **Connector won't connect** — the hosted endpoint is `https://mymedi-ai.com/mcp-stream` over Streamable HTTP. Verify it from a terminal: `npx -y @modelcontextprotocol/inspector --cli https://mymedi-ai.com/mcp-stream --transport http --method tools/list`.
- **Code not found** — lookups expect bare code strings (`E1390`, `99213`, `M79.3`). Denial codes accept `CO-50`, `co50`, or `50`.
- **Stale data concerns** — reference data follows CMS release cycles (HCPCS April 2026, PFS RVU Jan 2026, PA/F2F lists per Federal Register notices); each response carries its list version where applicable.
- **Still stuck?** Email support@mymedi-ai.com or open an issue at https://github.com/MyMedi-AI/mymedi-ai-mcp-server/issues.

## Links

- [API Discovery](https://mymedi-ai.com/agent/v1/discovery)
- [Try the demo](https://mymedi-ai.com/agent/v1/demo?code=99213)
- [Register for API Key](https://mymedi-ai.com/bot-marketplace/register)
- [Pricing](https://mymedi-ai.com/bot-marketplace/credits/pricing)
- [Marketplace homepage](https://mymedi-ai.com/bot-marketplace/)

## License

MIT
