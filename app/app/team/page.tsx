import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Users, UsersRound, Plus, Mail, Trash2, Save, UserPlus, X } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { recordAudit } from '@/utils/dara/audit';
import { sendInvitationEmail, TEAM_ROLES, INVITE_TTL_DAYS } from '@/utils/dara/teams';
import PageHeader from '@/components/dara/PageHeader';
import {
  card,
  fieldClasses,
  labelClasses,
  checkboxClasses,
  btnPrimary,
  btnGhost,
  btnDanger,
  sectionTitle,
  badgeBase
} from '@/components/dara/theme';

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

async function createTeam(formData: FormData) {
  'use server';
  const admin = await requireCompanyAdmin();
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  if (!name) return;
  const team = await withTenant(admin.companyId, (tx) =>
    tx.team.create({
      data: { companyId: admin.companyId, name: name.slice(0, 255), description: description?.slice(0, 500) }
    })
  );
  await recordAudit({
    action: 'team.create',
    companyId: admin.companyId,
    actorId: admin.id,
    actorEmail: admin.email,
    entityType: 'team',
    entityId: team.id,
    metadata: { name }
  });
  revalidatePath('/app/team');
}

async function deleteTeam(formData: FormData) {
  'use server';
  const admin = await requireCompanyAdmin();
  const teamId = BigInt(String(formData.get('teamId') ?? '0'));
  await withTenant(admin.companyId, async (tx) => {
    const team = await tx.team.findFirst({ where: { id: teamId, companyId: admin.companyId } });
    if (!team) return;
    await tx.team.delete({ where: { id: teamId } });
  });
  await recordAudit({
    action: 'team.delete',
    companyId: admin.companyId,
    actorId: admin.id,
    actorEmail: admin.email,
    entityType: 'team',
    entityId: teamId
  });
  revalidatePath('/app/team');
}

async function addExistingMember(formData: FormData) {
  'use server';
  const admin = await requireCompanyAdmin();
  const teamId = BigInt(String(formData.get('teamId') ?? '0'));
  const userId = String(formData.get('userId') ?? '');
  const role = String(formData.get('role') ?? 'reviewer');
  if (!userId) return;
  await withTenant(admin.companyId, async (tx) => {
    const team = await tx.team.findFirst({ where: { id: teamId, companyId: admin.companyId } });
    const user = await tx.daraUser.findFirst({ where: { id: userId, companyId: admin.companyId } });
    if (!team || !user) return;
    await tx.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      create: {
        companyId: admin.companyId,
        teamId,
        userId,
        role: (isRole(role) ? role : 'reviewer') as any
      },
      update: { role: (isRole(role) ? role : 'reviewer') as any }
    });
  });
  await recordAudit({
    action: 'team.member.add',
    companyId: admin.companyId,
    actorId: admin.id,
    actorEmail: admin.email,
    entityType: 'team',
    entityId: teamId,
    metadata: { userId, role }
  });
  revalidatePath('/app/team');
}

async function updateMemberRole(formData: FormData) {
  'use server';
  const admin = await requireCompanyAdmin();
  const memberId = BigInt(String(formData.get('memberId') ?? '0'));
  const role = String(formData.get('role') ?? 'reviewer');
  await withTenant(admin.companyId, async (tx) => {
    const member = await tx.teamMember.findFirst({ where: { id: memberId, companyId: admin.companyId } });
    if (!member) return;
    await tx.teamMember.update({
      where: { id: memberId },
      data: { role: (isRole(role) ? role : member.role) as any }
    });
  });
  await recordAudit({
    action: 'team.member.role',
    companyId: admin.companyId,
    actorId: admin.id,
    actorEmail: admin.email,
    entityType: 'team_member',
    entityId: memberId,
    metadata: { role }
  });
  revalidatePath('/app/team');
}

async function removeMember(formData: FormData) {
  'use server';
  const admin = await requireCompanyAdmin();
  const memberId = BigInt(String(formData.get('memberId') ?? '0'));
  await withTenant(admin.companyId, async (tx) => {
    const member = await tx.teamMember.findFirst({ where: { id: memberId, companyId: admin.companyId } });
    if (!member) return;
    await tx.teamMember.delete({ where: { id: memberId } });
  });
  await recordAudit({
    action: 'team.member.remove',
    companyId: admin.companyId,
    actorId: admin.id,
    actorEmail: admin.email,
    entityType: 'team_member',
    entityId: memberId
  });
  revalidatePath('/app/team');
}

async function inviteMember(formData: FormData) {
  'use server';
  const admin = await requireCompanyAdmin();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? 'reviewer');
  const teamRaw = String(formData.get('teamId') ?? '');
  const teamId = teamRaw ? BigInt(teamRaw) : null;
  if (!email || !email.includes('@')) return;

  const created = await withTenant(admin.companyId, async (tx) => {
    // Already a member of this company? Don't invite — assign to the team instead.
    const existing = await tx.daraUser.findFirst({ where: { email, companyId: admin.companyId } });
    if (existing) {
      if (teamId) {
        await tx.teamMember.upsert({
          where: { teamId_userId: { teamId, userId: existing.id } },
          create: { companyId: admin.companyId, teamId, userId: existing.id, role: (isRole(role) ? role : 'reviewer') as any },
          update: { role: (isRole(role) ? role : 'reviewer') as any }
        });
      }
      return null; // signal "existing user, no invite"
    }
    // Replace any prior pending invite for this email, then create a fresh one.
    await tx.invitation.updateMany({
      where: { email, companyId: admin.companyId, status: 'pending' },
      data: { status: 'revoked' }
    });
    return tx.invitation.create({
      data: {
        companyId: admin.companyId,
        teamId,
        email,
        role: (isRole(role) ? role : 'reviewer') as any,
        invitedById: admin.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400 * 1000)
      }
    });
  });

  if (created) {
    await sendInvitationEmail(email); // soft-fails; the row is the source of truth
    await recordAudit({
      action: 'invitation.create',
      companyId: admin.companyId,
      actorId: admin.id,
      actorEmail: admin.email,
      entityType: 'invitation',
      entityId: created.id,
      metadata: { email, role, teamId: teamId?.toString() ?? null }
    });
  }
  revalidatePath('/app/team');
}

// Company-level membership: the org-wide role (the company_admin gate) + active
// status. Distinct from per-team roles above. Ported from the old Settings > Users.
async function updateCompanyMember(formData: FormData) {
  'use server';
  const admin = await requireCompanyAdmin();
  const userId = String(formData.get('userId') ?? '');
  // Guard against self-lockout: an admin can't change their own role/active here.
  if (!userId || userId === admin.id) return;
  await withTenant(admin.companyId, async (tx) => {
    const target = await tx.daraUser.findFirst({ where: { id: userId, companyId: admin.companyId } });
    if (!target) return;
    const role = String(formData.get('role') ?? target.role);
    const isActive = formData.get('isActive') === 'on';
    await tx.daraUser.update({
      where: { id: userId },
      data: { role: (isRole(role) ? role : target.role) as any, isActive }
    });
    await recordAudit({
      action: 'member.update',
      companyId: admin.companyId,
      actorId: admin.id,
      actorEmail: admin.email,
      entityType: 'user',
      entityId: userId,
      metadata: { role, isActive, fromRole: target.role }
    });
  });
  revalidatePath('/app/team');
}

async function revokeInvitation(formData: FormData) {
  'use server';
  const admin = await requireCompanyAdmin();
  const inviteId = BigInt(String(formData.get('inviteId') ?? '0'));
  await withTenant(admin.companyId, async (tx) => {
    const invite = await tx.invitation.findFirst({ where: { id: inviteId, companyId: admin.companyId } });
    if (!invite) return;
    await tx.invitation.update({ where: { id: inviteId }, data: { status: 'revoked' } });
  });
  await recordAudit({
    action: 'invitation.revoke',
    companyId: admin.companyId,
    actorId: admin.id,
    actorEmail: admin.email,
    entityType: 'invitation',
    entityId: inviteId
  });
  revalidatePath('/app/team');
}

const roleBadge = `${badgeBase} border-line bg-bg text-t3`;

export default async function TeamPage() {
  const admin = await requireCompanyAdmin();
  const { teams, users, invites } = await withTenant(admin.companyId, async (tx) => {
    const teams = await tx.team.findMany({
      where: { companyId: admin.companyId },
      orderBy: { createdAt: 'asc' },
      include: {
        members: { include: { user: true }, orderBy: { createdAt: 'asc' } }
      }
    });
    const users = await tx.daraUser.findMany({
      where: { companyId: admin.companyId },
      orderBy: { createdAt: 'asc' }
    });
    const invites = await tx.invitation.findMany({
      where: { companyId: admin.companyId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: { team: true }
    });
    return { teams, users, invites };
  });

  return (
    <div className="mx-auto max-w-4xl fade">
      <PageHeader
        eyebrow="Account"
        title="Team"
        subtitle="Organize people into teams and assign their roles. Invite new members by email."
      />

      <div className="space-y-6">
        {/* Invite + create team */}
        <div className="grid gap-6 md:grid-cols-2">
          <section className={`${card} p-5`}>
            <h2 className={`mb-4 flex items-center gap-2 ${sectionTitle}`}>
              <Mail className="h-4 w-4 text-t5" />Invite a member
            </h2>
            <form action={inviteMember} className="space-y-3">
              <div className="space-y-1.5">
                <label className={labelClasses}>Email</label>
                <input name="email" type="email" required placeholder="person@company.com" className={fieldClasses} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={labelClasses}>Role</label>
                  <select name="role" defaultValue="reviewer" className={fieldClasses}>
                    {TEAM_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={labelClasses}>Team (optional)</label>
                  <select name="teamId" defaultValue="" className={fieldClasses}>
                    <option value="">— none —</option>
                    {teams.map((t) => (<option key={t.id.toString()} value={t.id.toString()}>{t.name}</option>))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end">
                <button type="submit" className={btnPrimary}><UserPlus className="h-4 w-4" />Send invite</button>
              </div>
              <p className="text-[11px] text-t5">
                They join on first sign-in. Invites expire in {INVITE_TTL_DAYS} days.
              </p>
            </form>
          </section>

          <section className={`${card} p-5`}>
            <h2 className={`mb-4 flex items-center gap-2 ${sectionTitle}`}>
              <Plus className="h-4 w-4 text-t5" />Create a team
            </h2>
            <form action={createTeam} className="space-y-3">
              <div className="space-y-1.5">
                <label className={labelClasses}>Name</label>
                <input name="name" type="text" required placeholder="e.g. Proposals" className={fieldClasses} />
              </div>
              <div className="space-y-1.5">
                <label className={labelClasses}>Description (optional)</label>
                <input name="description" type="text" placeholder="What this team does" className={fieldClasses} />
              </div>
              <div className="flex justify-end">
                <button type="submit" className={btnPrimary}><Plus className="h-4 w-4" />Create team</button>
              </div>
            </form>
          </section>
        </div>

        {/* Company members (org-wide role + active) */}
        <section className={`${card} p-5`}>
          <h2 className={`mb-4 flex items-center gap-2 ${sectionTitle}`}>
            <Users className="h-4 w-4 text-t5" />Members{' '}
            <span className="font-mono text-[11px] font-normal text-t5">({users.length})</span>
          </h2>
          <div className="space-y-2">
            {users.map((u) =>
              u.id === admin.id ? (
                <div key={u.id} className="flex items-center gap-3 rounded-lg border border-line bg-bg p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-t1">{u.name || u.email}</div>
                    <div className="truncate text-[11px] text-t5">{u.email}</div>
                  </div>
                  <span className={roleBadge}>{u.role}</span>
                  <span className="text-[11px] text-t5">you</span>
                </div>
              ) : (
                <form key={u.id} action={updateCompanyMember} className="flex items-center gap-3 rounded-lg border border-line bg-bg p-3">
                  <input type="hidden" name="userId" value={u.id} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-t1">{u.name || u.email}</div>
                    <div className="truncate text-[11px] text-t5">{u.email}</div>
                  </div>
                  <select name="role" defaultValue={u.role} className={`${fieldClasses} w-36`}>
                    {TEAM_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                  </select>
                  <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-t4">
                    <input type="checkbox" name="isActive" defaultChecked={u.isActive} className={checkboxClasses} />
                    active
                  </label>
                  <button type="submit" className={btnGhost}><Save className="h-4 w-4" />Save</button>
                </form>
              )
            )}
          </div>
          <p className="mt-3 text-[11px] text-t5">
            Company role governs app-wide access (only <span className="font-mono">company_admin</span> manages
            this page, billing, and settings). Per-team roles are set within each team below.
          </p>
        </section>

        {/* Pending invitations */}
        {invites.length > 0 && (
          <section className={`${card} p-5`}>
            <h2 className={`mb-4 flex items-center gap-2 ${sectionTitle}`}>
              <Mail className="h-4 w-4 text-t5" />Pending invitations{' '}
              <span className="font-mono text-[11px] font-normal text-t5">({invites.length})</span>
            </h2>
            <div className="space-y-2">
              {invites.map((inv) => (
                <form key={inv.id.toString()} action={revokeInvitation} className="flex items-center gap-3 rounded-lg border border-line bg-bg p-3">
                  <input type="hidden" name="inviteId" value={inv.id.toString()} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-t1">{inv.email}</div>
                    <div className="truncate text-[11px] text-t5">
                      {inv.team ? inv.team.name : 'no team'} · expires {inv.expiresAt.toISOString().slice(0, 10)}
                    </div>
                  </div>
                  <span className={roleBadge}>{inv.role}</span>
                  <button type="submit" className={btnGhost}><X className="h-4 w-4" />Revoke</button>
                </form>
              ))}
            </div>
          </section>
        )}

        {/* Teams */}
        {teams.length === 0 ? (
          <section className={`${card} p-8 text-center`}>
            <UsersRound className="mx-auto mb-3 h-7 w-7 text-t5" />
            <p className="text-[13px] text-t3">No teams yet. Create one above to start assigning members.</p>
          </section>
        ) : (
          teams.map((team) => {
            const memberIds = new Set(team.members.map((m) => m.userId));
            const assignable = users.filter((u) => !memberIds.has(u.id));
            return (
              <section key={team.id.toString()} className={`${card} p-5`}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
                      <UsersRound className="h-4 w-4 text-t5" />{team.name}{' '}
                      <span className="font-mono text-[11px] font-normal text-t5">({team.members.length})</span>
                    </h2>
                    {team.description && <p className="mt-1 text-[12px] text-t4">{team.description}</p>}
                  </div>
                  <form action={deleteTeam}>
                    <input type="hidden" name="teamId" value={team.id.toString()} />
                    <button type="submit" className={btnDanger}><Trash2 className="h-4 w-4" />Delete</button>
                  </form>
                </div>

                {/* Members */}
                <div className="space-y-2">
                  {team.members.length === 0 && (
                    <p className="text-[12px] text-t5">No members yet.</p>
                  )}
                  {team.members.map((m) => (
                    <div key={m.id.toString()} className="flex items-center gap-3 rounded-lg border border-line bg-bg p-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-t1">{m.user.name || m.user.email}</div>
                        <div className="truncate text-[11px] text-t5">{m.user.email}</div>
                      </div>
                      <form action={updateMemberRole} className="flex items-center gap-2">
                        <input type="hidden" name="memberId" value={m.id.toString()} />
                        <select name="role" defaultValue={m.role} className={`${fieldClasses} w-36`}>
                          {TEAM_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                        </select>
                        <button type="submit" className={btnGhost}><Save className="h-4 w-4" />Save</button>
                      </form>
                      <form action={removeMember}>
                        <input type="hidden" name="memberId" value={m.id.toString()} />
                        <button type="submit" className={btnGhost} title="Remove from team"><X className="h-4 w-4" /></button>
                      </form>
                    </div>
                  ))}
                </div>

                {/* Add existing member */}
                {assignable.length > 0 && (
                  <form action={addExistingMember} className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                    <input type="hidden" name="teamId" value={team.id.toString()} />
                    <Users className="h-4 w-4 shrink-0 text-t5" />
                    <select name="userId" defaultValue="" className={`${fieldClasses} flex-1`} required>
                      <option value="" disabled>Add existing member…</option>
                      {assignable.map((u) => (
                        <option key={u.id} value={u.id}>{u.name || u.email} ({u.email})</option>
                      ))}
                    </select>
                    <select name="role" defaultValue="reviewer" className={`${fieldClasses} w-36`}>
                      {TEAM_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                    </select>
                    <button type="submit" className={btnGhost}><UserPlus className="h-4 w-4" />Add</button>
                  </form>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
