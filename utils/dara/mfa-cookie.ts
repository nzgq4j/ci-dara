// DARA-031 (MFA) — recovery marker cookie.
//
// The primary second factor is Supabase TOTP, which elevates the session to AAL2 (the
// unforgeable source of truth the middleware gate reads). But a single-use BACKUP code
// can't make Supabase mint AAL2 (Supabase owns the TOTP secret, not us). So when a user
// clears the MFA challenge with a backup code, we set this short, HMAC-signed, httpOnly
// marker cookie instead, and the middleware accepts it as an equivalent "MFA satisfied"
// signal for the session.
//
// It is NOT a bypass: it is only ever issued server-side after a bcrypt-verified backup
// code (possession of a real second factor), it is signed with APP_KEY (an attacker can't
// forge it without the server secret), and it is httpOnly (client JS can't read/set it).
// It is bound to the user id and cleared on sign-out and on disabling MFA.
//
// Uses the Web Crypto API only (no node:crypto) so it is safe to import into the Edge
// middleware bundle as well as Node route handlers.

export const MFA_COOKIE = 'dara-mfa';

// Marker lifetime — kept in the same ballpark as a session; the cookie is cleared on
// sign-out regardless, so this is just an upper bound if a sign-out is missed.
export const MFA_COOKIE_MAX_AGE = 60 * 60 * 12; // 12h

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** Deterministic per-user marker value = HMAC-SHA256(APP_KEY, "mfa:<userId>"). */
export async function mfaMarker(userId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(process.env.APP_KEY ?? ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`mfa:${userId}`));
  return toHex(sig);
}

/** Constant-time check that a presented cookie value is the valid marker for this user. */
export async function isValidMfaMarker(
  userId: string,
  value: string | undefined | null
): Promise<boolean> {
  if (!value) return false;
  const expected = await mfaMarker(userId);
  if (value.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
