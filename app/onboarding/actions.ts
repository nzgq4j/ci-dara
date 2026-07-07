'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { recordAudit } from '@/utils/dara/audit';
import { LEGAL_VERSION } from '@/utils/dara/legal-content';

// Resolve the signed-in DARA user for an onboarding step. Cross-tenant safe: the
// user already has a company (provisioned at sign-in); we only ever touch their
// own company/user rows, scoped through withTenant().
async function requireOnboarder() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  return daraUser;
}

function slugify(name: string, companyId: bigint) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'org';
  // companyId is unique, so the slug is guaranteed collision-free.
  return `${base}-${companyId.toString(36)}`;
}

export async function saveProfile(
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const daraUser = await requireOnboarder();
  const n = name.trim().slice(0, 255);
  if (!n) return { ok: false, error: 'Your name is required.' };
  await withTenant(daraUser.companyId, (tx) =>
    tx.daraUser.update({ where: { id: daraUser.id }, data: { name: n } })
  );
  return { ok: true };
}

export async function saveOrganization(
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const daraUser = await requireOnboarder();
  const n = name.trim();
  if (!n) return { ok: false, error: 'Company name is required.' };
  await withTenant(daraUser.companyId, (tx) =>
    tx.company.update({
      where: { id: daraUser.companyId },
      data: { name: n.slice(0, 255), slug: slugify(n, daraUser.companyId) }
    })
  );
  return { ok: true };
}

export async function saveAiMode(
  mode: string
): Promise<{ ok: boolean; error?: string }> {
  const daraUser = await requireOnboarder();
  const m = mode === 'byok' ? 'byok' : 'platform';
  await withTenant(daraUser.companyId, (tx) =>
    tx.company.update({
      where: { id: daraUser.companyId },
      data: { aiKeyMode: m }
    })
  );
  return { ok: true };
}

// Record the user's acceptance of the current Terms of Service + Supplemental Policy
// Addendum, stamped at the moment the agreement checkbox is checked. Stores current-state
// on the user and writes an immutable acceptance event to the audit log (version, IP,
// user-agent). Used by both the onboarding Agreement step and the Settings Legal tab.
export async function acceptLegal(): Promise<{
  ok: boolean;
  error?: string;
  version?: string;
  acceptedAt?: string;
}> {
  const daraUser = await requireOnboarder();
  const now = new Date();
  await withTenant(daraUser.companyId, (tx) =>
    tx.daraUser.update({
      where: { id: daraUser.id },
      data: {
        tosAcceptedVersion: LEGAL_VERSION,
        tosAcceptedAt: now
      }
    })
  );
  const h = headers();
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || null;
  await recordAudit({
    action: 'legal.accept',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'user',
    entityId: daraUser.id,
    // The acceptance record: which version, and request provenance.
    metadata: { version: LEGAL_VERSION, ip, userAgent: h.get('user-agent') || null }
  });
  return { ok: true, version: LEGAL_VERSION, acceptedAt: now.toISOString() };
}

// Finish the org-creator wizard: stamp both the company and the user as onboarded
// (releases the layout gate) and drop them on the dashboard.
export async function completeOnboarding() {
  const daraUser = await requireOnboarder();
  const now = new Date();
  await withTenant(daraUser.companyId, async (tx) => {
    await tx.company.update({
      where: { id: daraUser.companyId },
      data: { onboardedAt: now }
    });
    await tx.daraUser.update({
      where: { id: daraUser.id },
      data: { onboardedAt: now }
    });
  });
  await recordAudit({
    action: 'onboarding.complete',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'company',
    entityId: daraUser.companyId,
    metadata: { kind: 'org_creator' }
  });
  redirect('/app/dashboard');
}
