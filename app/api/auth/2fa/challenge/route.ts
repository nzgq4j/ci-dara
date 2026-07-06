import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { prismaAdmin } from '@/utils/prisma';
import { getDaraUser } from '@/utils/dara/provision';
import { recordAudit } from '@/utils/dara/audit';
import { matchBackupCode } from '@/utils/dara/mfa';
import { MFA_COOKIE, MFA_COOKIE_MAX_AGE, mfaMarker } from '@/utils/dara/mfa-cookie';

// DARA-031 · POST /api/auth/2fa/challenge
// Login-time second factor. Accepts either a 6-digit TOTP `code` (elevates the Supabase
// session to AAL2) OR a single-use `backupCode` (consumes the code and sets the signed
// httpOnly recovery marker cookie the middleware accepts as MFA-satisfied). Returns
// success/failure only.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
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

  // --- TOTP path: elevate the real session to AAL2 (source of truth). ---
  if (code) {
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
    }
    const { data: factors } = await supabase.auth.mfa.listFactors();
    // listFactors().totp is verified factors only.
    const factor = factors?.totp?.[0];
    if (!factor) return NextResponse.json({ error: 'no_factor' }, { status: 400 });
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (error) return NextResponse.json({ error: 'invalid_code' }, { status: 400 });

    await recordAudit({
      action: 'mfa.challenge',
      companyId: daraUser.companyId,
      actorId: daraUser.id,
      actorEmail: daraUser.email,
      entityType: 'user',
      entityId: daraUser.id,
      metadata: { method: 'totp' }
    });
    return NextResponse.json({ ok: true });
  }

  // --- Backup-code path: consume a single-use code + set the recovery marker cookie. ---
  if (backupCode) {
    const hashes = daraUser.mfaBackupCodes ?? [];
    const idx = await matchBackupCode(backupCode, hashes);
    if (idx < 0) return NextResponse.json({ error: 'invalid_code' }, { status: 400 });

    const remaining = hashes.filter((_, i) => i !== idx);
    await prismaAdmin.daraUser.update({
      where: { id: user.id },
      data: { mfaBackupCodes: remaining }
    });
    await recordAudit({
      action: 'mfa.challenge',
      companyId: daraUser.companyId,
      actorId: daraUser.id,
      actorEmail: daraUser.email,
      entityType: 'user',
      entityId: daraUser.id,
      metadata: { method: 'backup', remaining: remaining.length }
    });

    const res = NextResponse.json({ ok: true, method: 'backup', remaining: remaining.length });
    res.cookies.set(MFA_COOKIE, await mfaMarker(user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: MFA_COOKIE_MAX_AGE
    });
    return res;
  }

  return NextResponse.json({ error: 'missing_code' }, { status: 400 });
}
