// DARA-046: marker cookie that forces a password reset to be completed before app access.
// Set when a recovery (password-reset) link is verified at /auth/confirm; the middleware
// then routes every /app request to the set-password screen until updatePassword() clears
// it. Presence-only — it only RESTRICTS access (fail-safe), so it needn't be signed: the
// worst an attacker could do by planting it (they can't; it's httpOnly + same-site) is force
// themselves to reset their own password. Edge-safe (a plain string constant).
export const PW_RESET_COOKIE = 'dara-pw-reset';

// 1h is long enough to finish the reset and short enough that an abandoned reset auto-clears
// (so a user who bails isn't stuck being redirected to the set-password screen forever).
export const PW_RESET_MAX_AGE = 60 * 60;
