/**
 * MCP resources for the npm server: two CMS lists read from the API and the
 * platform overview (llms.txt) read from the public site. No SDK import —
 * index.js registers them, and the MyMedi-AI app repo's
 * prompts.parity.test.js holds them equal to the hosted connector's copy
 * (server/mcp/promptsResources.js).
 */

export const PUBLIC_SITE_URL = 'https://mymedi-ai.com';
export const PUBLIC_TEXT_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

export const RESOURCE_DEFS = [
  {
    name: 'pa-required-list',
    uri: 'mymedi://datasets/pa-required-list',
    title: 'Medicare DMEPOS Required Prior Authorization List',
    description: 'Full CMS Required Prior Authorization List (42 CFR 414.234): HCPCS codes with category and nationwide-since date. Original Medicare FFS scope.',
    mimeType: 'application/json',
    fetchPath: '/agent/v1/codes/pa-required-list',
  },
  {
    name: 'f2f-wopd-list',
    uri: 'mymedi://datasets/f2f-wopd-list',
    title: 'Medicare F2F + WOPD requirements list',
    description: 'Full CMS face-to-face encounter and written-order-prior-to-delivery list (42 CFR 410.38(d)) plus the universal standard written order elements.',
    mimeType: 'application/json',
    fetchPath: '/agent/v1/codes/f2f-wopd-list',
  },
  {
    name: 'llms-txt',
    uri: `${PUBLIC_SITE_URL}/llms.txt`,
    title: 'MyMedi-AI platform overview (llms.txt)',
    description: 'What MyMedi-AI is, the tool catalog, pricing, and integration paths — written for AI agents.',
    mimeType: 'text/plain',
    // A static file of the public site, not an API route: read from the site
    // itself whatever MCP_API_BASE_URL points at. The fallback answers when
    // the site cannot.
    publicPath: '/llms.txt',
    fallbackText: [
      '# MyMedi-AI',
      '',
      '> DME billing intelligence for suppliers, billers and AI agents, built on public CMS data: HCPCS, ICD-10 and CPT code lookup, DMEPOS fee schedules, Medicare prior-authorization requirement checks, denial-code guidance and pre-submission claim checks. PHI-free by design.',
      '',
      'The full overview could not be loaded just now; it is published at https://mymedi-ai.com/llms.txt. Contact: info@mymedi-ai.com',
    ].join('\n'),
  },
];

const cache = new Map(); // uri -> { text, expiresAt }

/** Drop cached public texts (tests). */
export function clearResourceCache() {
  cache.clear();
}

/**
 * Read a public-site resource: 5 s timeout, one-hour cache. A non-2xx
 * answer, a network error, a timeout or an HTML page (a missing static file
 * can come back as the site's index.html with 200) returns the static
 * fallback and is not cached, so the next read retries.
 *
 * @param {{ uri: string, publicPath: string, fallbackText: string }} def
 * @param {{ fetchImpl?: typeof fetch, now?: number }} [options]
 * @returns {Promise<string>}
 */
export async function readPublicText(def, { fetchImpl = fetch, now = Date.now() } = {}) {
  const hit = cache.get(def.uri);
  if (hit && hit.expiresAt > now) return hit.text;
  try {
    const res = await fetchImpl(`${PUBLIC_SITE_URL}${def.publicPath}`, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || type.includes('text/html')) throw new Error(`unusable response (${res.status} ${type})`);
    const text = await res.text();
    cache.set(def.uri, { text, expiresAt: now + PUBLIC_TEXT_TTL_MS });
    return text;
  } catch {
    return def.fallbackText;
  }
}

/**
 * Read an API-backed resource; a non-2xx answer is an error the client sees.
 *
 * @param {{ fetchPath: string }} def
 * @param {{ apiBaseUrl: string, headers: Record<string, string>, fetchImpl?: typeof fetch }} options
 * @returns {Promise<string>}
 */
export async function readApiText(def, { apiBaseUrl, headers, fetchImpl = fetch }) {
  const response = await fetchImpl(`${apiBaseUrl}${def.fetchPath}`, { method: 'GET', headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${def.fetchPath}: HTTP ${response.status}`);
  }
  return response.text();
}
