'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { recordAudit } from '@/utils/dara/audit';
import { sendInvitationEmail, TEAM_ROLES, INVITE_TTL_DAYS } from '@/utils/dara/teams';

async function requireCompanyAdmin() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  if (daraUser.role !== 'company_admin') redirect('/app/dashboard');
  return daraUser;
}

const isRole = (r: string) => (TEAM_ROLES as readonly string[]).includes(r);

export async function inviteUser(
  email: string,
  role: string,
  teamId: string | null
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireCompanyAdmin();
  const e = email.trim().toLowerCase();
  if (!e || !e.includes('@')) return { ok: false, error: 'Enter a valid email.' };
  const r = (isRole(role) ? role : 'reviewer') as any;
  const tid = teamId ? BigInt(teamId) : null;

  const created = await withTenant(admin.companyId, async (tx) => {
    if (tid) {
      const team = await tx.team.findFirst({ where: { id: tid, companyId: admin.companyId } });
      if (!team) throw new Error('Department not found.');
    }
    // Already a member? Assign to the chosen department instead of inviting.
    const existing = await tx.daraUser.findFirst({ where: { email: e, companyId: admin.companyId } });
    if (existing) {
      if (tid) {
        await tx.teamMember.deleteMany({ where: { userId: existing.id, companyId: admin.companyId } });
        await tx.teamMember.create({ data: { companyId: admin.companyId, teamId: tid, userId: existing.id, role: r } });
      }
      await tx.daraUser.update({ where: { id: existing.id }, data: { role: r } });
      return null;
    }
    await tx.invitation.updateMany({
      where: { email: e, companyId: admin.companyId, status: 'pending' },
      data: { status: 'revoked' }
    });
    return tx.invitation.create({
      data: {
        companyId: admin.companyId,
        teamId: tid,
        email: e,
        role: r,
        invitedById: admin.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400 * 1000)
      }
    });
  });

  if (created) {
    const mail = await sendInvitationEmail(e);
    await recordAudit({
      action: 'invitation.create',
      companyId: admin.companyId,
      actorId: admin.id,
      actorEmail: admin.email,
      entityType: 'invitation',
      entityId: created.id,
      metadata: { email: e, role, teamId: teamId ?? null, emailSent: mail.ok }
    });
  } else {
    await recordAudit({
      action: 'member.update',
      companyId: admin.companyId,
      actorId: admin.id,
      actorEmail: admin.email,
      entityType: 'user',
      entityId: e,
      metadata: { role, teamId: teamId ?? null, viaInvite: true }
    });
  }
  revalidatePath('/app/team');
  return { ok: true };
}

export async function createDepartment(
  name: string,
  description: string | null
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireCompanyAdmin();
  const n = name.trim();
  if (!n) return { ok: false, error: 'Name is required.' };
  try {
    const team = await withTenant(admin.companyId, (tx) =>
      tx.team.create({
        data: {
          companyId: admin.companyId,
          name: n.slice(0, 255),
          description: description?.trim()?.slice(0, 500) || null
        }
      })
    );
    await recordAudit({
      action: 'team.create',
      companyId: admin.companyId,
      actorId: admin.id,
      actorEmail: admin.email,
      entityType: 'team',
      entityId: team.id,
      metadata: { name: n }
    });
  } catch (err: any) {
    // Unique (companyId, name) violation.
    if (err?.code === 'P2002') return { ok: false, error: 'A department with that name already exists.' };
    throw err;
  }
  revalidatePath('/app/team');
  return { ok: true };
}

export async function deleteDepartment(teamId: string) {
  const admin = await requireCompanyAdmin();
  const tid = BigInt(teamId);
  await withTenant(admin.companyId, async (tx) => {
    const team = await tx.team.findFirst({ where: { id: tid, companyId: admin.companyId } });
    if (!team) return;
    await tx.team.delete({ where: { id: tid } });
  });
  await recordAudit({
    action: 'team.delete',
    companyId: admin.companyId,
    actorId: admin.id,
    actorEmail: admin.email,
    entityType: 'team',
    entityId: tid
  });
  revalidatePath('/app/team');
}

export async function setUserRole(userId: string, role: string) {
  const admin = await requireCompanyAdmin();
  if (userId === admin.id) return; // self-lockout guard
  const r = (isRole(role) ? role : 'reviewer') as any;
  await withTenant(admin.companyId, async (tx) => {
    const target = await tx.daraUser.findFirst({ where: { id: userId, companyId: admin.companyId } });
    if (!target) return;
    await tx.daraUser.update({ where: { id: userId }, data: { role: r } });
    // Keep the user's team-membership role in step with their company role.
    await tx.teamMember.updateMany({ where: { userId, companyId: admin.companyId }, data: { role: r } });
    await recordAudit({
      action: 'member.update',
      companyId: admin.companyId,
      actorId: admin.id,
      actorEmail: admin.email,
      entityType: 'user',
      entityId: userId,
      metadata: { role, fromRole: target.role }
    });
  });
  revalidatePath('/app/team');
}

// Single-department model (matches the prototype): a user belongs to one
// department. Assigning replaces any existing membership; null clears it.
export async function setUserDepartment(userId: string, teamId: string | null) {
  const admin = await requireCompanyAdmin();
  const tid = teamId ? BigInt(teamId) : null;
  await withTenant(admin.companyId, async (tx) => {
    const target = await tx.daraUser.findFirst({ where: { id: userId, companyId: admin.companyId } });
    if (!target) return;
    if (tid) {
      const team = await tx.team.findFirst({ where: { id: tid, companyId: admin.companyId } });
      if (!team) return;
    }
    await tx.teamMember.deleteMany({ where: { userId, companyId: admin.companyId } });
    if (tid) {
      await tx.teamMember.create({
        data: { companyId: admin.companyId, teamId: tid, userId, role: target.role }
      });
    }
    await recordAudit({
      action: 'team.member.assign',
      companyId: admin.companyId,
      actorId: admin.id,
      actorEmail: admin.email,
      entityType: 'user',
      entityId: userId,
      metadata: { teamId: teamId ?? null }
    });
  });
  revalidatePath('/app/team');
}

export async function setUserActive(userId: string, isActive: boolean) {
  const admin = await requireCompanyAdmin();
  if (userId === admin.id) return; // can't deactivate yourself
  await withTenant(admin.companyId, async (tx) => {
    const target = await tx.daraUser.findFirst({ where: { id: userId, companyId: admin.companyId } });
    if (!target) return;
    await tx.daraUser.update({ where: { id: userId }, data: { isActive } });
    await recordAudit({
      action: 'member.update',
      companyId: admin.companyId,
      actorId: admin.id,
      actorEmail: admin.email,
      entityType: 'user',
      entityId: userId,
      metadata: { isActive }
    });
  });
  revalidatePath('/app/team');
}

export async function revokeInvitation(inviteId: string) {
  const admin = await requireCompanyAdmin();
  const id = BigInt(inviteId);
  await withTenant(admin.companyId, async (tx) => {
    const invite = await tx.invitation.findFirst({ where: { id, companyId: admin.companyId } });
    if (!invite) return;
    await tx.invitation.update({ where: { id }, data: { status: 'revoked' } });
  });
  await recordAudit({
    action: 'invitation.revoke',
    companyId: admin.companyId,
    actorId: admin.id,
    actorEmail: admin.email,
    entityType: 'invitation',
    entityId: id
  });
  revalidatePath('/app/team');
}
