import type { Prisma } from '@prisma/client';
import type { TenantTx } from '@/utils/prisma';

// Department-scoped solicitation access (app-layer enforcement; company-level RLS
// remains the DB tenant backstop — DARA-004). Rules (confirmed 2026-06-29):
//   - company_admin: sees every solicitation in the company.
//   - creator: always sees solicitations they created.
//   - everyone else: sees a solicitation only if it is assigned to a department
//     they belong to. An unassigned solicitation is therefore visible only to
//     admins + its creator.

export function isCompanyAdmin(role: string): boolean {
  return role === 'company_admin';
}

// The team (department) ids a user belongs to. Call inside withTenant.
export async function userTeamIds(tx: TenantTx, userId: string): Promise<bigint[]> {
  const rows = await tx.teamMember.findMany({
    where: { userId },
    select: { teamId: true }
  });
  return rows.map((r) => r.teamId);
}

// A Prisma `where` fragment that limits solicitations to those the user may see.
// Combine with the caller's companyId filter. Admins get an empty fragment (no
// restriction beyond company). Pass the user's teamIds (from userTeamIds()).
export function solAccessWhere(
  userId: string,
  role: string,
  teamIds: bigint[]
): Prisma.SolicitationWhereInput {
  if (isCompanyAdmin(role)) return {};
  return {
    OR: [
      { createdBy: userId },
      { departments: { some: { teamId: { in: teamIds } } } }
    ]
  };
}

// Whether a user may view a specific solicitation, given its department team ids.
export function canViewSolicitation(
  userId: string,
  role: string,
  createdBy: string | null,
  solTeamIds: bigint[],
  userTeamIdSet: Set<bigint>
): boolean {
  if (isCompanyAdmin(role)) return true;
  if (createdBy && createdBy === userId) return true;
  return solTeamIds.some((t) => userTeamIdSet.has(t));
}

// Who may change a solicitation's department assignments: admins + the creator.
export function canManageDepartments(
  userId: string,
  role: string,
  createdBy: string | null
): boolean {
  return isCompanyAdmin(role) || (!!createdBy && createdBy === userId);
}
