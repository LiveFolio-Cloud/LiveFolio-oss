/**
 * OSS stub for lib/ai/quota-gate.ts.
 *
 * The Cloud original is the usage gate: it reports a workspace's monthly AI
 * assistant limit and refuses the request past it, and it gates the
 * `web_search` / `web_fetch` tools on a paid tier. Its comments and error
 * strings spell out the packaging — which tier unlocks which tool, and that
 * web tools carry a vendor cost the platform absorbs. That is commercial
 * logic and it is not ours to publish.
 *
 * BEHAVIOUR-IDENTICAL, not merely a no-op. Both exported gates short-circuit
 * to `{ ok: true }` in OSS, and they already did before this stub existed:
 *
 *   assertAiQuotaGates  → returns `{ ok: true }` when there is no user or org
 *                         context, which is always the case in OSS (no auth).
 *                         Even with context, the two checks it delegates to —
 *                         `assertMessageQuota` and `assertStorageQuota` —
 *                         resolve against the OSS `ee/middleware/usageCapping`
 *                         stub, which is always-allowed.
 *   assertWebToolPlan   → returns `{ ok: true }` when `!isCloud` (`:121`), and
 *                         `isCloud` is a build-time `false` in OSS.
 *
 * So every value returned here is the value the Cloud implementation already
 * returned in OSS mode.
 *
 * The result unions are reproduced in FULL, including the `ok: false` arms
 * that this stub never constructs. Declaring only `{ ok: true }` would narrow
 * each caller's `if (!gate.ok)` branch to `never` and fail the OSS type-check
 * on `gate.body` / `gate.status`. The same narrowing trap applies to several
 * other stubs in this tree — reproduce the full union, not just the arm the
 * stub happens to return.
 */

export type QuotaGateResult =
  | { ok: true }
  | {
      ok: false;
      status: 402;
      body: {
        error: 'QUOTA_EXCEEDED' | 'STORAGE_EXCEEDED';
        message: string;
        quota: unknown;
      };
    };

/**
 * Run the message-quota gate, then the storage-quota gate, in that order.
 *
 * Always `{ ok: true }` in OSS: a self-hosted instance has no billing cycle
 * and no plan, so there is no limit to enforce and nothing to upgrade to.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mirrors the Cloud signature; OSS has no quota to resolve
export async function assertAiQuotaGates(opts: {
  userId?: string | null;
  orgId?: string | null;
  enabled?: boolean;
}): Promise<QuotaGateResult> {
  return { ok: true };
}

export type WebToolGateResult =
  | { ok: true }
  | { ok: false; status: 401 | 402; body: { success: false; message: string } };

/**
 * Plan gate for the web tools.
 *
 * Always `{ ok: true }` in OSS: there are no plans locally, so every tool the
 * operator has configured a key for stays available. The Cloud version fails
 * CLOSED when a plan cannot be determined; here there is no plan to determine.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mirrors the Cloud signature; OSS has no plans to resolve
export async function assertWebToolPlan(opts: {
  toolName: string;
  orgId?: string | null;
}): Promise<WebToolGateResult> {
  return { ok: true };
}
