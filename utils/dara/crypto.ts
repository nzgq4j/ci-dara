import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

// AES-256-GCM encryption for API keys at rest, keyed off APP_KEY.
// Format: "v1:" + base64(iv[12] || authTag[16] || ciphertext).

function key(): Buffer {
  // Derive a stable 32-byte key from APP_KEY regardless of its format.
  return createHash('sha256').update(process.env.APP_KEY ?? '').digest();
}

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(payload: string | null | undefined): string {
  if (!payload) return '';
  if (!payload.startsWith('v1:')) return payload; // tolerate legacy plaintext
  try {
    const raw = Buffer.from(payload.slice(3), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** A short, non-reversible hint for display (last 4 chars), or '' if empty. */
export function secretHint(payload: string | null | undefined): string {
  const plain = decryptSecret(payload);
  if (!plain) return '';
  return '••••' + plain.slice(-4);
}
