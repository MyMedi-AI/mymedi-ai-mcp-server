/**
 * A REST 402 turned into the tool result a person reads in the chat.
 *
 * The REST body is translated, never spread: spreading let its generic
 * `message` overwrite this text and re-advertised payment rails that are
 * switched off server-side. No credit count is baked in for the keyless
 * case: this package is published independently of the API, so any number
 * here would go stale the moment the starter grant moves.
 *
 * A keyed install is sent to buy_credits, which opens a Stripe checkout for
 * that key's own credits. The web credits page is not offered: it tops up the
 * signed-in web account (the claude.ai connector's pool), which is a
 * different account from a key registered over the API.
 *
 * A key the API does not recognise (mistyped, incomplete, revoked) also comes
 * back as 402, with creditInfo.creditError "Invalid API key" and no balance:
 * that is a key problem, not an empty balance, and buy_credits would refuse
 * the same key — so the answer says to check the key or register.
 */

const CREDITS_PER_USD = 1000;

// Batch tools are priced per code; the rest per call.
const priceLabel = (toolDef) => `${toolDef.price} per ${toolDef.schema?.codes ? 'code' : 'call'}`;

/**
 * @param {object} input
 * @param {object} input.toolDef - the MCP_TOOLS entry that was called
 * @param {object} [input.paymentInfo] - parsed REST 402 body (may be empty)
 * @param {string} input.apiKey - the key the call billed ('' when none)
 * @param {string} input.apiBaseUrl - the REST API base URL
 * @returns {{ content: Array<{ type: 'text', text: string }>, isError: true }}
 */
export function formatPaymentRequired({ toolDef, paymentInfo = {}, apiKey, apiBaseUrl }) {
  let body;
  if (!apiKey) body = keyRequired(toolDef, apiBaseUrl);
  else if (paymentInfo?.creditInfo?.creditError === 'Invalid API key') body = keyNotRecognised(toolDef, apiBaseUrl);
  else body = outOfCredits(toolDef, paymentInfo);
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], isError: true };
}

// Signup source the register route stores (it keeps letters, digits, - and
// _), so registrations that followed one of these answers can be counted.
const SIGNUP_SOURCE = 'mcp-npm-402';

// The registration request, as data and as a command a developer can run.
function registration(apiBaseUrl) {
  const request = { method: 'POST', url: `${apiBaseUrl}/bot-marketplace/register`, body: { name: 'my-agent', source: SIGNUP_SOURCE } };
  const command = `curl -X POST ${request.url} -H "Content-Type: application/json" -d '${JSON.stringify(request.body)}'`;
  return { request, command };
}

function outOfCredits(toolDef, paymentInfo) {
  const balance = paymentInfo?.creditInfo?.creditBalance;
  const required = paymentInfo?.pricing?.creditsRequired ?? paymentInfo?.creditInfo?.creditsRequired;
  const recommended = paymentInfo?.topUp?.recommendedPackage;
  const hasBalance = typeof balance === 'number';
  const hasRequired = typeof required === 'number';
  const shortfall = hasBalance && hasRequired ? Math.max(required - balance, 0) : undefined;
  return {
    error: 'payment_required',
    message: `Out of credits — ${toolDef.name} costs ${hasRequired ? `${required} credits` : priceLabel(toolDef)}`
      + (hasBalance ? `; the balance is ${balance} credits` : '')
      + `. Call buy_credits for a Stripe checkout link ($1 buys ${CREDITS_PER_USD.toLocaleString('en-US')} credits; free tools keep working), then retry.`,
    tool: toolDef.name,
    priceUSD: toolDef.price,
    ...(hasRequired && { creditsRequired: required }),
    ...(hasBalance && { creditBalance: balance }),
    ...(shortfall !== undefined && { shortfallCredits: shortfall }),
    ...(recommended && { recommendedPackage: { name: recommended.name, amountUSD: recommended.amountUSD, credits: recommended.credits } }),
    nextStep: { tool: 'buy_credits', ...(recommended?.name && { args: { package: String(recommended.name).toLowerCase() } }) },
    accountTool: 'account_status',
  };
}

function keyRequired(toolDef, apiBaseUrl) {
  const { request, command } = registration(apiBaseUrl);
  return {
    error: 'payment_required',
    message: `${toolDef.name} is a paid tool (${priceLabel(toolDef)}) and this server has no API key. `
      + `Get one with free starter credits by sending a POST request — the URL is not a web page: ${command}. `
      + 'Set MCP_API_KEY to the apiKey it returns and restart the server; buy_credits tops the key up later. '
      + 'The free tools work without a key.',
    tool: toolDef.name,
    priceUSD: toolDef.price,
    register: request,
    setEnv: 'MCP_API_KEY',
  };
}

function keyNotRecognised(toolDef, apiBaseUrl) {
  const { request, command } = registration(apiBaseUrl);
  return {
    error: 'invalid_api_key',
    message: `${toolDef.name} is a paid tool (${priceLabel(toolDef)}) and the API key this server sends was not recognised — `
      + 'it may be mistyped, incomplete or revoked. Check MCP_API_KEY (or the MYMEDI_API_KEY alias) and restart the server, '
      + `or get a new key with free starter credits by sending a POST request — the URL is not a web page: ${command}. `
      + 'The free tools work without a key.',
    tool: toolDef.name,
    priceUSD: toolDef.price,
    register: request,
    setEnv: 'MCP_API_KEY',
  };
}
