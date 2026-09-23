/**
 * OSS stub for lib/encryption.ts — swapped in by the downstream sync.
 *
 * A self-hosted install has no integrations table, no Slack/Discord bot
 * tokens, and no admin client that could ever reach the decryption call
 * sites. The only importer that ships (the comments route) guards those calls
 * behind the same cloud-only branch that the integrations themselves live
 * behind, so this function is never invoked here.
 *
 * The stub exists so the shared import compiles, and throws loudly rather
 * than pretend to encrypt with a key this build has no business holding.
 */

const NOT_AVAILABLE = 'Token encryption is not available in the self-hosted build.';

export function encryptToken(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the real signature
  _token: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the real signature
  _keyOverride?: string
): string {
  throw new Error(NOT_AVAILABLE);
}

export function decryptToken(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the real signature
  _encryptedData: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the real signature
  _keyOverride?: string
): string {
  throw new Error(NOT_AVAILABLE);
}
