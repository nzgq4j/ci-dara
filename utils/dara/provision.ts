import type { Invitation } from '@prisma/client';
import { prismaAdmin } from '@/utils/prisma';
import { recordAudit } from '@/utils/dara/audit';

// Thrown when a sign-in matches a pending invitation to another company but the
// signer has not proven they own the email. Callers catch this and route the user
// to "confirm your email" instead of provisioning. (See provisionNewUser.)
export class EmailVerificationRequiredError extends Error {
  constructor() {
    super('email_verification_required');
    this.name = 'EmailVerificationRequiredError';
  }
}

// Cross-tenant bootstrap: provisioning runs BEFORE a tenant context exists (the
// company is being created here), and getDaraUser is the per-request *source* of
// companyId — it must resolve a user before any tenant GUC could be set. Both
// therefore use prismaAdmin, never the RLS-scoped tenant client. (DARA-004)
//
// `emailVerified` MUST reflect that the signer has proven ownership of `email`
// (Supabase `email_confirmed_at` is set — true for OAuth/magic-link, and for
// password only once the address is confirmed). It gates invitation acceptance.
export async function provisionNewUser(
  supabaseUserId: string,
  email: string,
  name: string,
  emailVerified: boolean
) {
  const existing = await prismaAdmin.daraUser.findUnique({
    where: { id: supabaseUserId },
    include: { company: true },
  });

  if (existing) return existing;

  // Team invitations: if this email was invited to an existing company, attach the
  // new user there (with the invited role) instead of creating a fresh company.
  // Matched case-insensitively against pending, unexpired invites; newest wins.
  const normalizedEmail = email.trim().toLowerCase();
  const invite = await prismaAdmin.invitation.findFirst({
    where: {
      email: normalizedEmail,
      status: 'pending',
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (invite) {
    // SECURITY (defense-in-depth): only let an invitation attach this account to
    // another company's tenant once the signer has proven they own this email.
    // OAuth and magic-link inherently prove ownership; password sign-up only does
    // after the address is confirmed. Without this gate, a user who registers an
    // address they do not control — when Supabase "Confirm email" is disabled —
    // could claim a seat invited to that address and read that company's data.
    // This does NOT rely on the Supabase setting being on.
    if (!emailVerified) throw new EmailVerificationRequiredError();
    return acceptInvitation(supabaseUserId, normalizedEmail, name, invite);
  }

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
        trialEndsAt: new Date(Date.now() + 30 * 86400 * 1000),
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

// Raw lookup — returns the row regardless of active state. Only the app-shell layout
// uses this, to render the terminal "account disabled" screen. Everything else (server
// actions, route handlers, pages) must resolve the current user via getDaraUser, which
// is fail-closed.
export async function findDaraUserRaw(supabaseUserId: string) {
  return prismaAdmin.daraUser.findUnique({
    where: { id: supabaseUserId },
    include: { company: true },
  });
}

// SEC-06 (NIST AC-2 / IA-4): fail-closed on deactivation. A banned/deactivated user must
// lose ALL application access independent of the best-effort Supabase-side auth ban (which
// swallows errors, and even on success leaves existing tokens valid until jwt_expiry).
// Returning null for an inactive account makes every caller that resolves "the current
// user" — server actions and route handlers included, not just the page shell — treat a
// disabled account as unauthenticated.
export async function getDaraUser(supabaseUserId: string) {
  const user = await findDaraUserRaw(supabaseUserId);
  if (!user || !user.isActive) return null;
  return user;
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

// Attach a newly-signing-in user to a company they were invited to. The caller has
// already confirmed the invite is pending+unexpired AND that the email is verified.
// Cross-tenant by design — runs before any tenant GUC is set — so it uses prismaAdmin
// (DARA-004).
async function acceptInvitation(
  supabaseUserId: string,
  normalizedEmail: string,
  name: string,
  invite: Invitation
) {
  const user = await prismaAdmin.$transaction(async (tx) => {
    const created = await tx.daraUser.create({
      data: {
        id: supabaseUserId,
        companyId: invite.companyId,
        email: normalizedEmail,
        name: name || normalizedEmail,
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
