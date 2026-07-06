import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { prismaAdmin } from '@/utils/prisma';
import { getDaraUser } from '@/utils/dara/provision';
import { recordAudit } from '@/utils/dara/audit';
import { generateBackupCodes, hashBackupCodes } from '@/utils/dara/mfa';

// DARA-031 · POST /api/auth/2fa/verify
// Complete enrollment: verify the first TOTP code, which elevates the session to AAL2 and
// marks the factor verified in Supabase. On success we generate 10 single-use backup
// codes, store ONLY their bcrypt hashes, and return the plaintext codes ONCE.
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
  const factorId = typeof body.factorId === 'string' ? body.factorId : '';
  const code = String(body.code ?? '').replace(/\s/g, '');
  if (!factorId || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  }

  // Factor verified + session now AAL2. Mint backup codes (shown once).
  const codes = generateBackupCodes();
  const hashes = await hashBackupCodes(codes);
  await prismaAdmin.daraUser.update({
    where: { id: user.id },
    data: { mfaEnabled: true, mfaBackupCodes: hashes }
  });

  await recordAudit({
    action: 'mfa.enable',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'user',
    entityId: daraUser.id,
    metadata: { factor: 'totp', backupCodes: codes.length }
  });

  return NextResponse.json({ backupCodes: codes });
}
