'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { recordAudit } from '@/utils/dara/audit';

// Mark an invited user as having seen the one-screen welcome, then send them to
// the dashboard. Only the per-user flag is set — the company was already onboarded
// by its creator.
export async function completeWelcome() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');

  await withTenant(daraUser.companyId, (tx) =>
    tx.daraUser.update({
      where: { id: daraUser.id },
      data: { onboardedAt: new Date() }
    })
  );
  await recordAudit({
    action: 'onboarding.complete',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'user',
    entityId: daraUser.id,
    metadata: { kind: 'invited_member' }
  });
  redirect('/app/dashboard');
}
