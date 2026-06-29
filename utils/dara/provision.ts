import { prismaAdmin } from '@/utils/prisma';
import { recordAudit } from '@/utils/dara/audit';

// Cross-tenant bootstrap: provisioning runs BEFORE a tenant context exists (the
// company is being created here), and getDaraUser is the per-request *source* of
// companyId — it must resolve a user before any tenant GUC could be set. Both
// therefore use prismaAdmin, never the RLS-scoped tenant client. (DARA-004)
export async function provisionNewUser(
  supabaseUserId: string,
  email: string,
  name: string
) {
  const existing = await prismaAdmin.daraUser.findUnique({
    where: { id: supabaseUserId },
    include: { company: true },
  });

  if (existing) return existing;

  // Team invitations: if this email was invited to an existing company, attach the
  // new user there (with the invited role) instead of creating a fresh company.
  // Runs on prismaAdmin because no tenant context exists yet (DARA-004). Matched
  // case-insensitively against pending, unexpired invites; newest wins.
  const invited = await acceptInvitationOnProvision(supabaseUserId, email, name);
  if (invited) return invited;

  const companyBase = name || email.split('@')[0];
  const slug =
    companyBase
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) +
    '-' +
    Date.now().toString(36);

  // One transaction so a failed user-create cannot orphan a company.
  const user = await prismaAdmin.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: companyBase,
        slug,
        plan: 'trial',
        planStatus: 'trialing',
        trialEndsAt: new Date(Date.now() + 14 * 86400 * 1000),
      },
    });

    return tx.daraUser.create({
      data: {
        id: supabaseUserId,
        companyId: company.id,
        email,
        name: name || email,
        role: 'company_admin',
      },
      include: { company: true },
    });
  });

  await recordAudit({
    action: 'user.provision',
    companyId: user.companyId,
    actorId: user.id,
    actorEmail: user.email,
    entityType: 'company',
    entityId: user.companyId,
    metadata: { newCompany: true, slug }
  });

  return user;
}

export async function getDaraUser(supabaseUserId: string) {
  return prismaAdmin.daraUser.findUnique({
    where: { id: supabaseUserId },
    include: { company: true },
  });
}

// Record a sign-in time (powers the Team page "Last active" column). Best-effort:
// runs on the auth paths only (not every request) and never throws into the caller.
export async function touchLastLogin(supabaseUserId: string) {
  try {
    await prismaAdmin.daraUser.update({
      where: { id: supabaseUserId },
      data: { lastLoginAt: new Date() },
    });
  } catch (e) {
    console.error('[provision] touchLastLogin failed:', e);
  }
}

// Attach a newly-signing-in user to a company they were invited to. Returns the
// created DaraUser (with company) on success, or null if there is no usable invite
// (caller then falls back to creating a new company). Cross-tenant by design — runs
// before any tenant GUC is set — so it uses prismaAdmin (DARA-004).
async function acceptInvitationOnProvision(
  supabaseUserId: string,
  email: string,
  name: string
) {
  const normalizedEmail = email.trim().toLowerCase();
  const invite = await prismaAdmin.invitation.findFirst({
    where: {
      email: normalizedEmail,
      status: 'pending',
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!invite) return null;

  const user = await prismaAdmin.$transaction(async (tx) => {
    const created = await tx.daraUser.create({
      data: {
        id: supabaseUserId,
        companyId: invite.companyId,
        email: normalizedEmail,
        name: name || email,
        // Company-level role mirrors the invited role; the company_admin gate is
        // what matters for company-wide screens, team role lives on TeamMember.
        role: invite.role,
      },
      include: { company: true },
    });

    if (invite.teamId) {
      await tx.teamMember.create({
        data: {
          companyId: invite.companyId,
          teamId: invite.teamId,
          userId: supabaseUserId,
          role: invite.role,
        },
      });
    }

    await tx.invitation.update({
      where: { id: invite.id },
      data: { status: 'accepted', acceptedAt: new Date() },
    });

    return created;
  });

  await recordAudit({
    action: 'invitation.accept',
    companyId: invite.companyId,
    actorId: user.id,
    actorEmail: user.email,
    entityType: 'invitation',
    entityId: invite.id,
    metadata: { role: invite.role, teamId: invite.teamId?.toString() ?? null },
  });

  return user;
}