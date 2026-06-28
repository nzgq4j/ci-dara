import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

// AES-256-GCM encryption for API keys at rest, keyed off APP_KEY.
// Format: "v1:" + base64(iv[12] || authTag[16] || ciphertext).

const APP_KEY = process.env.APP_KEY ?? '';

// DARA-019: the derived key is only as strong as APP_KEY's entropy. Warn loudly
// if it is missing or weak so a low-entropy key never goes unnoticed.
if (APP_KEY.length < 32) {
  console.warn(
    '[crypto] APP_KEY is missing or shorter than 32 chars — BYOK key encryption ' +
      'is weak. Set a high-entropy APP_KEY (e.g. `openssl rand -hex 32`).'
  );
}

function key(): Buffer {
  // Derive a stable 32-byte key from APP_KEY regardless of its format.
  return createHash('sha256').update(APP_KEY).digest();
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
  // DARA-019: no plaintext fallback — anything not in the v1: envelope is treated
  // as "no value" rather than silently returned as a usable secret.
  if (!payload.startsWith('v1:')) return '';
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

// ── Field-level encryption for CUI at rest (DARA-009) ──────────────────────────
// Same AES-256-GCM "v1:" envelope, used for document extracted_text. Unlike
// decryptSecret, decryptField TOLERATES legacy plaintext so rows written before
// DARA-009 keep working until the one-time backfill
// (prisma/security/backfill-dara009-encrypt-extracted-text.ts) encrypts them.

export function encryptField(plain: string | null | undefined): string {
  if (!plain) return '';
  return encryptSecret(plain);
}

export function decryptField(payload: string | null | undefined): string {
  if (!payload) return '';
  if (!payload.startsWith('v1:')) return payload; // legacy plaintext (pre-DARA-009)
  return decryptSecret(payload);
}

/** A short, non-reversible hint for display (last 4 chars), or '' if empty. */
export function secretHint(payload: string | null | undefined): string {
  const plain = decryptSecret(payload);
  if (!plain) return '';
  return '••••' + plain.slice(-4);
}
