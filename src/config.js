/**
 * Environment settings for calling the MyMedi-AI API, read when a server is
 * built (not at import), so each one sees the current environment.
 */

export const DEFAULT_API_BASE_URL = 'https://mymedi-ai.com';

const firstNonBlank = (...values) => values.map((value) => String(value ?? '').trim()).find(Boolean) ?? '';

/**
 * The API key paid tools bill against. MCP_API_KEY is the documented name;
 * MYMEDI_API_KEY is accepted too, because the registration response's
 * quickStart prints that name. MCP_API_KEY wins when both are set, and a
 * blank value counts as unset.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} the key, or '' when none is set
 */
export function resolveApiKey(env = process.env) {
  return firstNonBlank(env.MCP_API_KEY, env.MYMEDI_API_KEY);
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} MCP_API_BASE_URL without a trailing slash, or the default
 */
export function resolveApiBaseUrl(env = process.env) {
  return (firstNonBlank(env.MCP_API_BASE_URL) || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}

/**
 * Shared-egress deployments (e.g. a hosted multi-user proxy) set
 * MCP_CONNECTOR_TOKEN so the API can give them an elevated rate-limit bucket
 * instead of the per-IP one. Not needed for individual installs.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveConnectorToken(env = process.env) {
  return firstNonBlank(env.MCP_CONNECTOR_TOKEN);
}
