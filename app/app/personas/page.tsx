import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { seedBuiltinPersonas } from '@/utils/dara/personas';
import PersonaManager, { type PersonaItem } from './PersonaManager';

export default async function PersonasPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  const companyId = daraUser.companyId;

  const { personas, usage } = await withTenant(companyId, async (tx) => {
    const count = await tx.persona.count({ where: { companyId } });
    if (count === 0) await seedBuiltinPersonas(tx, companyId);
    const personas = await tx.persona.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
    });
    const usage = await tx.evaluation.groupBy({
      by: ['personaId'],
      where: { companyId },
      _count: { _all: true }
    });
    return { personas, usage };
  });

  const usedIn = new Map(usage.map((u) => [u.personaId.toString(), u._count._all]));

  const items: PersonaItem[] = personas.map((p) => ({
    id: p.id.toString(),
    displayName: p.displayName,
    systemPrompt: p.systemPrompt,
    isActive: p.isActive,
    icon: p.icon ?? null,
    usedIn: usedIn.get(p.id.toString()) ?? 0
  }));

  return <PersonaManager personas={items} />;
}
