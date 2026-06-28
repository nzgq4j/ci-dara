import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Save, Building2, Users } from 'lucide-react';
import { prismaAdmin } from '@/utils/prisma';
import { requirePlatformAdmin } from '@/utils/dara/admin';
import { secretHint } from '@/utils/dara/crypto';
import PageHeader from '@/components/dara/PageHeader';
import {
  card,
  fieldClasses,
  labelClasses,
  checkboxClasses,
  btnGhost,
  sectionTitle
} from '@/components/dara/theme';

const PLANS = ['trial', 'starter', 'pro', 'enterprise'];
const PLAN_STATUSES = ['active', 'past_due', 'canceled', 'trialing'];
const PROVIDERS = ['anthropic', 'openai', 'google'];
const KEY_MODES = ['platform', 'byok'];
const ROLES = ['company_admin', 'dept_admin', 'manager', 'reviewer'];

function pick(list: string[], val: string, fallback: string) {
  return list.includes(val) ? val : fallback;
}

async function updateCompany(formData: FormData) {
  'use server';
  await requirePlatformAdmin();
  const id = BigInt(String(formData.get('companyId')));
  const trialRaw = String(formData.get('trialEndsAt') ?? '').trim();
  await prismaAdmin.company.update({
    where: { id },
    data: {
      plan: pick(PLANS, String(formData.get('plan') ?? ''), 'trial') as any,
      planStatus: pick(PLAN_STATUSES, String(formData.get('planStatus') ?? ''), 'trialing') as any,
      trialEndsAt: trialRaw ? new Date(trialRaw) : null,
      aiKeyMode: pick(KEY_MODES, String(formData.get('aiKeyMode') ?? ''), 'platform') as any,
      activeProvider: pick(PROVIDERS, String(formData.get('activeProvider') ?? ''), 'anthropic') as any,
      activeModel: String(formData.get('activeModel') ?? '').trim() || 'claude-sonnet-4-6'
    }
  });
  revalidatePath('/app/admin');
}

async function updateAnyUser(formData: FormData) {
  'use server';
  await requirePlatformAdmin();
  const userId = String(formData.get('userId') ?? '');
  const target = await prismaAdmin.daraUser.findUnique({ where: { id: userId } });
  if (!target) return;
  await prismaAdmin.daraUser.update({
    where: { id: userId },
    data: {
      role: pick(ROLES, String(formData.get('role') ?? ''), target.role) as any,
      isActive: formData.get('isActive') === 'on'
    }
  });
  revalidatePath('/app/admin');
}

export default async function AdminPage() {
  await requirePlatformAdmin();

  const companies = await prismaAdmin.company.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { users: true, solicitations: true, evaluations: true } }
    }
  });
  const users = await prismaAdmin.daraUser.findMany({
    orderBy: { createdAt: 'asc' },
    include: { company: { select: { name: true } } }
  });

  return (
    <div className="mx-auto max-w-5xl fade">
      <PageHeader
        eyebrow="Platform"
        title="Platform Admin"
        subtitle={`${companies.length} accounts · ${users.length} users`}
      />

      <div className="space-y-8">
        {/* Companies */}
        <section className="space-y-4">
          <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
            <Building2 className="h-4 w-4 text-t5" />Accounts
          </h2>
          {companies.map((c) => (
            <form key={c.id.toString()} action={updateCompany} className={`${card} p-4`}>
              <input type="hidden" name="companyId" value={c.id.toString()} />
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[13px] font-semibold text-t1">{c.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-t5">/{c.slug}</span>
                </div>
                <div className="font-mono text-[11px] text-t5">
                  {c._count.users} users · {c._count.solicitations} solicitations · {c._count.evaluations} evals
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <label className={labelClasses}>Plan</label>
                  <select name="plan" defaultValue={c.plan} className={fieldClasses}>
                    {PLANS.map((p) => (<option key={p} value={p}>{p}</option>))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={labelClasses}>Plan status</label>
                  <select name="planStatus" defaultValue={c.planStatus} className={fieldClasses}>
                    {PLAN_STATUSES.map((p) => (<option key={p} value={p}>{p}</option>))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={labelClasses}>Trial ends</label>
                  <input
                    name="trialEndsAt"
                    type="date"
                    defaultValue={c.trialEndsAt ? c.trialEndsAt.toISOString().slice(0, 10) : ''}
                    className={fieldClasses}
                  />
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <div className="space-y-1.5">
                  <label className={labelClasses}>Key mode</label>
                  <select name="aiKeyMode" defaultValue={c.aiKeyMode} className={fieldClasses}>
                    {KEY_MODES.map((m) => (<option key={m} value={m}>{m}</option>))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={labelClasses}>Provider</label>
                  <select name="activeProvider" defaultValue={c.activeProvider} className={fieldClasses}>
                    {PROVIDERS.map((p) => (<option key={p} value={p}>{p}</option>))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={labelClasses}>Model</label>
                  <input name="activeModel" type="text" defaultValue={c.activeModel} className={fieldClasses} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClasses}>Keys</label>
                  <div className="px-1 py-2 font-mono text-[11px] text-t4">
                    {[
                      ['A', secretHint(c.anthropicKeyEnc)],
                      ['O', secretHint(c.openaiKeyEnc)],
                      ['G', secretHint(c.googleKeyEnc)]
                    ]
                      .map(([k, h]) => `${k}:${h ? '✓' : '–'}`)
                      .join('  ')}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button type="submit" className={btnGhost}><Save className="h-4 w-4" />Save account</button>
              </div>
            </form>
          ))}
        </section>

        {/* Users */}
        <section className="space-y-4">
          <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
            <Users className="h-4 w-4 text-t5" />All Users{' '}
            <span className="font-mono text-[11px] font-normal text-t5">({users.length})</span>
          </h2>
          <div className="space-y-2">
            {users.map((u) => (
              <form key={u.id} action={updateAnyUser} className={`${card} flex items-center gap-3 p-3`}>
                <input type="hidden" name="userId" value={u.id} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-t1">{u.email}</div>
                  <div className="truncate text-[11px] text-t5">{u.company.name}</div>
                </div>
                <select name="role" defaultValue={u.role} className={`${fieldClasses} w-40`}>
                  {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                </select>
                <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-t4">
                  <input type="checkbox" name="isActive" defaultChecked={u.isActive} className={checkboxClasses} />
                  active
                </label>
                <button type="submit" className={btnGhost}><Save className="h-4 w-4" />Save</button>
              </form>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
