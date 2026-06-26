import { prisma } from '@/utils/prisma';

export async function provisionNewUser(
  supabaseUserId: string,
  email: string,
  name: string
) {
  const existing = await prisma.daraUser.findUnique({
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

  const company = await prisma.company.create({
    data: {
      name: companyBase,
      slug,
      plan: 'trial',
      planStatus: 'trialing',
      trialEndsAt: new Date(Date.now() + 14 * 86400 * 1000),
    },
  });

  const user = await prisma.daraUser.create({
    data: {
      id: supabaseUserId,
      companyId: company.id,
      email,
      name: name || email,
      role: 'company_admin',
    },
    include: { company: true },
  });

  return user;
}

export async function getDaraUser(supabaseUserId: string) {
  return prisma.daraUser.findUnique({
    where: { id: supabaseUserId },
    include: { company: true },
  });
}