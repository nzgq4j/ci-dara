import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

// DARA-031 (MFA) — single-use backup (recovery) codes.
//
// Supabase manages the TOTP factor but has no backup-code concept, so we provide our own.
// Codes are high-entropy and shown to the user exactly once (at setup / regeneration);
// only bcrypt hashes are persisted (dara_users.mfa_backup_codes). This module imports
// bcrypt, so it must NOT be pulled into the middleware/edge bundle — server routes only.

const CODE_COUNT = 10;
const BCRYPT_ROUNDS = 10;

// Crockford-ish base32 without ambiguous chars (no 0/O/1/I) for readable codes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

function randomCode(): string {
  // 10 chars → ~49 bits of entropy; formatted XXXXX-XXXXX for readability.
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
    if (i === 4) out += '-';
  }
  return out;
}

/** Generate N plaintext backup codes to show the user once. */
export function generateBackupCodes(n: number = CODE_COUNT): string[] {
  return Array.from({ length: n }, () => randomCode());
}

/** Bcrypt-hash each plaintext code for storage. */
export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcrypt.hash(normalize(c), BCRYPT_ROUNDS)));
}

// Normalize user input: strip spaces/hyphens, uppercase — so "abcde fghjk" and
// "ABCDE-FGHJK" match the same stored hash.
function normalize(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Check a presented backup code against the stored hashes. Returns the index of the
 * matching hash (so the caller can consume/remove it) or -1 if none match. Single-use is
 * enforced by the caller removing the matched hash.
 */
export async function matchBackupCode(
  presented: string,
  hashes: string[]
): Promise<number> {
  const candidate = normalize(presented);
  if (!candidate) return -1;
  for (let i = 0; i < hashes.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(candidate, hashes[i])) return i;
  }
  return -1;
}
