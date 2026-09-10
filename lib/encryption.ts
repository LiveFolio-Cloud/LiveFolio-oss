import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.LIVEFOLIO_API_KEY || 'a3b9f3d9d300e84b2c15147820a894bc';

// Hash key to exactly 32 bytes for AES-256
const hashedKey = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();

/**
 * Encrypts a plain token with AES-256-CBC.
 */
export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', hashedKey, iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-CBC encrypted token text.
 */
export function decryptToken(encryptedData: string): string {
  const [ivHex, encryptedText] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', hashedKey, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
