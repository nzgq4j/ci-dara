import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Save, Building2, Users } from 'lucide-react';
import { prisma } from '@/utils/prisma';
import { requirePlatformAdmin } from '@/utils/dara/admin';
import { secretHint } from '@/utils/dara/crypto';

const fieldClasses =
  'w-full rounded-md border border-[#1a2f4a] bg-[#070c16] px-3 py-2 text-sm text-white placeholder:text-[#7d97b3] focus:border-[#3b6ef0] focus:outline-none focus:ring-1 focus:ring-[#3b6ef0]';
const labelClasses = 'text-xs font-medium uppercase tracking-wide text-[#7d97b3]';
const ghostBtn =
  'inline-flex items-center gap-2 rounded-md border border-[#1a2f4a] px-3 py-2 text-sm text-[#7d97b3] transition-colors hover:text-white';

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
  await prisma.company.update({
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
  const target = await prisma.daraUser.findUnique({ where: { id: userId } });
  if (!target) return;
  await prisma.daraUser.update({
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

  const companies = await prisma.company.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { users: true, solicitations: true, evaluations: true } }
    }
  });
  const users = await prisma.daraUser.findMany({
    orderBy: { createdAt: 'asc' },
    include: { company: { select: { name: true } } }
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Platform Admin</h1>
        <p className="text-sm text-[#7d97b3]">
          {companies.length} accounts · {users.length} users
        </p>
      </div>

      {/* Companies */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Building2 className="h-5 w-5 text-[#7d97b3]" />Accounts
        </h2>
        {companies.map((c) => (
          <form
            key={c.id.toString()}
            action={updateCompany}
            className="rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-4"
          >
            <input type="hidden" name="companyId" value={c.id.toString()} />
            <div className="mb-3 flex items-center justify-between">
              <div>
                <span className="font-medium text-white">{c.name}</span>
                <span className="ml-2 text-xs text-[#7d97b3]">/{c.slug}</span>
              </div>
              <div className="text-xs text-[#7d97b3]">
                {c._count.users} users · {c._count.solicitations} solicitations ·{' '}
                {c._count.evaluations} evals
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
                <div className="px-1 py-2 text-xs text-[#7d97b3]">
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
              <button type="submit" className={ghostBtn}><Save className="h-4 w-4" />Save account</button>
            </div>
          </form>
        ))}
      </section>

      {/* Users */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Users className="h-5 w-5 text-[#7d97b3]" />All Users{' '}
          <span className="text-sm font-normal text-[#7d97b3]">({users.length})</span>
        </h2>
        <div className="space-y-2">
          {users.map((u) => (
            <form key={u.id} action={updateAnyUser} className="flex items-center gap-3 rounded-md border border-[#1a2f4a] bg-[#0d1527] p-3">
              <input type="hidden" name="userId" value={u.id} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white">{u.email}</div>
                <div className="truncate text-xs text-[#7d97b3]">{u.company.name}</div>
              </div>
              <select name="role" defaultValue={u.role} className={`${fieldClasses} w-40`}>
                {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
              </select>
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-[#7d97b3]">
                <input type="checkbox" name="isActive" defaultChecked={u.isActive} className="h-4 w-4 rounded border-[#1a2f4a] bg-[#070c16]" />
                active
              </label>
              <button type="submit" className={ghostBtn}><Save className="h-4 w-4" />Save</button>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
