'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { recordAudit } from '@/utils/dara/audit';
import { seedBuiltinPersonas } from '@/utils/dara/personas';

async function authed() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  return daraUser;
}

export async function createPersona(): Promise<string> {
  const u = await authed();
  const id = await withTenant(u.companyId, async (tx) => {
    const count = await tx.persona.count({ where: { companyId: u.companyId } });
    const created = await tx.persona.create({
      data: {
        companyId: u.companyId,
        displayName: 'New persona',
        systemPrompt:
          'You are an evaluator. Assess the proposal against: {{CRITERION_NAME}} — {{CRITERION_DESCRIPTION}}. Solicitation: {{SOLICITATION_TITLE}} ({{REFERENCE_NUMBER}}). FAR: {{FAR_REFERENCE}}.',
        isActive: true,
        sortOrder: count
      }
    });
    return created.id;
  });
  await recordAudit({
    action: 'persona.create',
    companyId: u.companyId,
    actorId: u.id,
    actorEmail: u.email,
    entityType: 'persona',
    entityId: id
  });
  revalidatePath('/app/personas');
  return id.toString();
}

export async function updatePersona(
  idStr: string,
  displayName: string,
  systemPrompt: string
) {
  const u = await authed();
  const id = BigInt(idStr);
  const name = displayName.trim().slice(0, 200);
  const prompt = systemPrompt.trim().slice(0, 20000);
  if (!name || !prompt) return;
  await withTenant(u.companyId, async (tx) => {
    const owned = await tx.persona.findFirst({ where: { id, companyId: u.companyId } });
    if (!owned) return;
    await tx.persona.update({
      where: { id },
      data: { displayName: name, systemPrompt: prompt }
    });
  });
  await recordAudit({
    action: 'persona.update',
    companyId: u.companyId,
    actorId: u.id,
    actorEmail: u.email,
    entityType: 'persona',
    entityId: id
  });
  revalidatePath('/app/personas');
}

export async function deletePersona(idStr: string) {
  const u = await authed();
  const id = BigInt(idStr);
  await withTenant(u.companyId, async (tx) => {
    const owned = await tx.persona.findFirst({ where: { id, companyId: u.companyId } });
    if (!owned) return;
    await tx.persona.delete({ where: { id } });
  });
  await recordAudit({
    action: 'persona.delete',
    companyId: u.companyId,
    actorId: u.id,
    actorEmail: u.email,
    entityType: 'persona',
    entityId: id
  });
  revalidatePath('/app/personas');
}

export async function togglePersonaActive(idStr: string) {
  const u = await authed();
  const id = BigInt(idStr);
  const next = await withTenant(u.companyId, async (tx) => {
    const owned = await tx.persona.findFirst({ where: { id, companyId: u.companyId } });
    if (!owned) return null;
    const isActive = !owned.isActive;
    await tx.persona.update({ where: { id }, data: { isActive } });
    return isActive;
  });
  if (next !== null) {
    await recordAudit({
      action: 'persona.toggle',
      companyId: u.companyId,
      actorId: u.id,
      actorEmail: u.email,
      entityType: 'persona',
      entityId: id,
      metadata: { isActive: next }
    });
  }
  revalidatePath('/app/personas');
}

export async function restorePersonaDefaults() {
  const u = await authed();
  const created = await withTenant(u.companyId, (tx) =>
    seedBuiltinPersonas(tx, u.companyId)
  );
  await recordAudit({
    action: 'persona.restore_defaults',
    companyId: u.companyId,
    actorId: u.id,
    actorEmail: u.email,
    entityType: 'persona',
    metadata: { created }
  });
  revalidatePath('/app/personas');
}
