import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { prismaAdmin } from '@/utils/prisma';
import { getDaraUser } from '@/utils/dara/provision';
import { recordAudit } from '@/utils/dara/audit';
import { matchBackupCode } from '@/utils/dara/mfa';
import { MFA_COOKIE } from '@/utils/dara/mfa-cookie';

// DARA-031 · DELETE /api/auth/2fa/disable
// Turn MFA off. Requires proof of the current factor — a valid TOTP `code` or a valid
// `backupCode` — then unenrolls every TOTP factor in Supabase, clears the backup codes,
// and clears the recovery marker cookie.
export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? '').replace(/\s/g, '');
  const backupCode = String(body.backupCode ?? '').trim();

  const { data: factors } = await supabase.auth.mfa.listFactors();
  // .totp = verified factors only; .all includes any unverified leftovers to clean up.
  const verified = factors?.totp?.[0];
  const allTotp = (factors?.all ?? []).filter((f) => f.factor_type === 'totp');

  let ok = false;
  if (code && /^\d{6}$/.test(code) && verified) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: verified.id, code });
    ok = !error;
  } else if (backupCode) {
    ok = (await matchBackupCode(backupCode, daraUser.mfaBackupCodes ?? [])) >= 0;
  }
  if (!ok) return NextResponse.json({ error: 'invalid_code' }, { status: 400 });

  for (const f of allTotp) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  await prismaAdmin.daraUser.update({
    where: { id: user.id },
    data: { mfaEnabled: false, mfaBackupCodes: [] }
  });
  await recordAudit({
    action: 'mfa.disable',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'user',
    entityId: daraUser.id
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(MFA_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  });
  return res;
}
