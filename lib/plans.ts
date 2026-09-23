/**
 * OSS stub for lib/plans.ts.
 *
 * The Cloud module is the packaging table: which hosted tier includes teammate
 * seating, how many seats a workspace has bought, and how many AI assistant
 * messages come bundled with one. Those are commercial terms. They are
 * deliberately NOT reproduced here — not even redacted, since a redacted
 * figure still discloses that there IS a figure and roughly how big it is.
 *
 * A self-hosted install is one workspace with no plans, no seats and no
 * billing. There is nothing to package, so the exports below say exactly that:
 * the instance imposes no message allowance, and everyone who can reach it is
 * a full member of it. Read on their own they describe a local-first
 * deployment, not a hosted tier.
 *
 * The export surface is identical to the Cloud module — `lib/auth.ts`,
 * `lib/auth-provisioner.ts` and `lib/mcp/tools/workspace.ts` all import from
 * here, and every one of them already short-circuits in OSS before it would
 * reach these calls (there is no auth, so nothing is ever provisioned, and
 * `handleManageMember` throws at its `isOSS` guard). They must still compile.
 */

/**
 * Messages granted to a workspace each month.
 *
 * No allowance is imposed on a self-hosted instance, so this is the largest
 * value the arithmetic downstream can hold without losing precision — the same
 * "unlimited" convention the OSS usage-capping stub uses for storage.
 */
export const NEW_WORKSPACE_MESSAGE_LIMIT = Number.MAX_SAFE_INTEGER;

/**
 * Whether teammates can be invited to a workspace, and up to how many.
 *
 * Mirrors the Cloud union exactly so call sites narrow identically. The
 * `canInvite: false` arm is never constructed here — there is no plan to fail
 * to qualify for — but it is part of the type because `workspace.ts` reads
 * `inviteBlockedMessage` off it, and dropping the arm would narrow that read
 * to `never` and fail the OSS type-check.
 */
export type TeammateSeating =
  | {
      canInvite: true;
      /** Members + pending invites allowed; `null` means uncapped. */
      seatLimit: number | null;
    }
  | {
      canInvite: false;
      /** Surfaced verbatim to the caller when an invite is refused. */
      inviteBlockedMessage: string;
    };

/**
 * Resolves teammate seating for a workspace.
 *
 * Unconditional in OSS: a self-hosted instance has a single workspace and no
 * concept of a paid seat, so membership is never capped and never gated behind
 * an upgrade. The arguments are accepted to match the Cloud signature; there
 * is no plan here to resolve them against.
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- the signature must stay identical to the Cloud module's so call sites type-check; neither argument has anything to resolve against in OSS */
export function teammateSeating(
  plan: string,
  monthlyMessageLimit: number
): TeammateSeating {
  return { canInvite: true, seatLimit: null };
}
/* eslint-enable @typescript-eslint/no-unused-vars */
