import { prismaAdmin } from '@/utils/prisma';

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

  return user;
}

export async function getDaraUser(supabaseUserId: string) {
  return prismaAdmin.daraUser.findUnique({
    where: { id: supabaseUserId },
    include: { company: true },
  });
}