/**
 * OSS stub for lib/mcp/tools/marketplace.ts.
 *
 * The Cloud original implements the paid-access gate, Explore listing
 * management, marketplace search, the checkout purchase flow, purchase
 * history and the payout account seller account. All of that is the commercial
 * surface of the hosted product: it names the fee boundary, the payout
 * corridors and the Connect onboarding rules, none of which belong in a public
 * tree.
 *
 * `app/api/mcp/route.ts` imports the six handlers at module top level
 * (`route.ts:13`) and registers them in its `TOOL_HANDLERS` dispatch table
 * (`route.ts:1032-1037`), unconditionally — only the tool *advertisement* is
 * gated (`if (!isOSS) { tools.push(…) }`). So the module must exist with an
 * identical export surface, or the OSS build cannot resolve the MCP server.
 *
 * Each handler throws the same message the Cloud implementation threw from its
 * own `isOSS` guard, so a raw JSON-RPC call to one of these methods — the only
 * way to reach them, since they are never advertised in OSS — fails with the
 * exact error it failed with before.
 */

/** Read or change a folio's paid-access gate (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- mirrors the Cloud signature; arguments are unvalidated JSON-RPC params
export async function handleManagePaidAccess(args: any): Promise<never> {
  throw new Error('Paid access is a cloud feature and is not available in OSS mode.');
}

/** Read or change Explore listing metadata + eligibility (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- mirrors the Cloud signature; arguments are unvalidated JSON-RPC params
export async function handleManageListing(args: any): Promise<never> {
  throw new Error('Marketplace listings are a cloud feature and are not available in OSS mode.');
}

/** Browse the public Explore marketplace (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- mirrors the Cloud signature; arguments are unvalidated JSON-RPC params
export async function handleSearchMarketplace(args: any): Promise<never> {
  throw new Error('Marketplace search is a cloud feature and is not available in OSS mode.');
}

/** Start a purchase for a gated folio (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- mirrors the Cloud signature; arguments are unvalidated JSON-RPC params
export async function handleBuyProject(args: any): Promise<never> {
  throw new Error('Purchases are a cloud feature and are not available in OSS mode.');
}

/** Purchase status poll or full history (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- mirrors the Cloud signature; arguments are unvalidated JSON-RPC params
export async function handleGetPurchases(args: any): Promise<never> {
  throw new Error('Purchases are a cloud feature and are not available in OSS mode.');
}

/** Seller payout account status or onboarding URL (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- mirrors the Cloud signature; arguments are unvalidated JSON-RPC params
export async function handleManageSellerAccount(args: any): Promise<never> {
  throw new Error('Seller accounts are a cloud feature and are not available in OSS mode.');
}

/** No commercial capability lines in a self-hosted install — no marketplace,
 *  no seller onboarding, no payment rails. */
export const MARKETPLACE_INSTRUCTION_LINES: string[] = [];

// The Cloud module also exports the tool advertisements themselves. Nothing
// is advertised here: a self-hosted install has no marketplace and no paid
// purchase flow. Present so the module surface matches the Cloud original and
// `app/api/mcp/route.ts` compiles against either.
export const MARKETPLACE_TOOLS: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];

// Same reasoning — these describe capabilities this build does not have.
export const MARKETPLACE_CAPABILITY_INSTRUCTIONS: string[] = [];
export const MARKETPLACE_CONVENTION_INSTRUCTIONS: string[] = [];
