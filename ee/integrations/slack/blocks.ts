/**
 * OSS stub for ee/integrations/slack/blocks.ts.
 *
 * The OSS build has no Slack integrations (no bot tokens, no OAuth), so
 * these Block Kit builders are never exercised at runtime. The stub keeps
 * the same export surface so shared routes (e.g. the comments route) still
 * type-check and import cleanly.
 *
 * bin/sync-oss.js swaps this in for ee/integrations/slack/blocks.ts.
 */

export interface SlackBlockPayload {
  channel?: string;
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors the Cloud interface; heterogeneous Block Kit blocks
  blocks: any[];
}

/** Stub: no Slack in OSS — returns an empty payload. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature; params unused in OSS
export function buildFolioGenerationBlock(_params: {
  folioId: string;
  title: string;
  prompt: string;
  authorEmail: string;
  previewUrl: string;
  thumbnailUrl?: string;
}): SlackBlockPayload {
  return { text: '', blocks: [] };
}

/** Stub: no Slack in OSS — returns an empty payload. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature; params unused in OSS
export function buildCommentPinnedBlock(_params: {
  folioId: string;
  folioTitle: string;
  author: string;
  text: string;
  previewUrl: string;
}): SlackBlockPayload {
  return { text: '', blocks: [] };
}
