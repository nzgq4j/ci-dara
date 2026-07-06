import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';

// DARA-031 · POST /api/auth/2fa/setup
// Begin TOTP enrollment. Supabase generates + stores the secret (we never do). Returns the
// base32 secret + a QR data-URL for the authenticator app, ONCE. The factor is created
// "unverified" and does not affect the session's AAL until /verify succeeds.
export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // Fail closed on deactivated accounts (SEC-06 / DARA-026).
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: factors } = await supabase.auth.mfa.listFactors();
  // listFactors().totp is VERIFIED factors only; .all includes unverified ones.
  if ((factors?.totp?.length ?? 0) > 0) {
    // Already fully enabled — must disable first (single-factor opt-in model).
    return NextResponse.json({ error: 'already_enabled' }, { status: 409 });
  }
  // Clean up any abandoned unverified factors so enroll() doesn't collide on friendly name.
  const stale = (factors?.all ?? []).filter(
    (f) => f.factor_type === 'totp' && f.status === 'unverified'
  );
  for (const f of stale) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `DARA (${user.email ?? user.id})`
  });
  if (error || !data || data.type !== 'totp') {
    return NextResponse.json({ error: 'enroll_failed' }, { status: 500 });
  }

  // The secret is returned to the client for QR / manual entry and is never logged or
  // persisted on our side.
  return NextResponse.json({
    factorId: data.id,
    secret: data.totp.secret,
    qr: data.totp.qr_code
  });
}
