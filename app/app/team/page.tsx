import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import TeamView, { type DeptItem, type MemberItem, type InviteItem } from './TeamView';

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

// "Last active" relative formatting, computed server-side to avoid hydration drift.
function relativeTime(d: Date | null): string {
  if (!d) return 'Never';
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'Yesterday';
  if (day < 7) return `${day} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default async function TeamPage() {
  const admin = await requireCompanyAdmin();
  const { company, teams, users, invites } = await withTenant(admin.companyId, async (tx) => {
    const company = await tx.company.findUnique({ where: { id: admin.companyId } });
    const teams = await tx.team.findMany({
      where: { companyId: admin.companyId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { members: true } } }
    });
    const users = await tx.daraUser.findMany({
      where: { companyId: admin.companyId },
      orderBy: { createdAt: 'asc' },
      include: { teamMemberships: { include: { team: true }, orderBy: { createdAt: 'asc' }, take: 1 } }
    });
    const invites = await tx.invitation.findMany({
      where: { companyId: admin.companyId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: { team: true }
    });
    return { company, teams, users, invites };
  });
  if (!company) redirect('/app/dashboard');

  const departments: DeptItem[] = teams.map((t) => ({
    id: t.id.toString(),
    name: t.name,
    userCount: t._count.members
  }));

  const members: MemberItem[] = users.map((u) => {
    const m = u.teamMemberships[0];
    return {
      id: u.id,
      name: u.name || u.email,
      email: u.email,
      avatarUrl: u.avatarUrl,
      role: u.role,
      isActive: u.isActive,
      departmentId: m ? m.teamId.toString() : null,
      departmentName: m ? m.team.name : null,
      lastActive: relativeTime(u.lastLoginAt),
      isSelf: u.id === admin.id
    };
  });

  const pendingInvites: InviteItem[] = invites.map((inv) => ({
    id: inv.id.toString(),
    email: inv.email,
    role: inv.role,
    departmentName: inv.team?.name ?? null,
    expires: inv.expiresAt.toISOString().slice(0, 10)
  }));

  return (
    <TeamView
      companyName={company.name}
      departments={departments}
      members={members}
      invites={pendingInvites}
    />
  );
}
