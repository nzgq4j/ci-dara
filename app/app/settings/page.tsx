import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Save, KeyRound, Users } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { prisma } from '@/utils/prisma';
import { encryptSecret, secretHint } from '@/utils/dara/crypto';

const fieldClasses =
  'w-full rounded-md border border-[#1a2f4a] bg-[#070c16] px-3 py-2 text-sm text-white placeholder:text-[#7d97b3] focus:border-[#3b6ef0] focus:outline-none focus:ring-1 focus:ring-[#3b6ef0]';
const labelClasses = 'text-xs font-medium uppercase tracking-wide text-[#7d97b3]';
const primaryBtn =
  'inline-flex items-center gap-2 rounded-md bg-[#3b6ef0] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f5fd6]';
const ghostBtn =
  'inline-flex items-center gap-2 rounded-md border border-[#1a2f4a] px-3 py-2 text-sm text-[#7d97b3] transition-colors hover:text-white';

const PROVIDERS = ['anthropic', 'openai', 'google'];
const KEY_MODES = ['platform', 'byok'];
const ROLES = ['company_admin', 'dept_admin', 'manager', 'reviewer'];

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

async function updateAIConfig(formData: FormData) {
  'use server';
  const daraUser = await requireCompanyAdmin();
  const aiKeyMode = String(formData.get('aiKeyMode') ?? 'platform');
  const activeProvider = String(formData.get('activeProvider') ?? 'anthropic');
  const activeModel = String(formData.get('activeModel') ?? '').trim() || 'claude-sonnet-4-6';
  await prisma.company.update({
    where: { id: daraUser.companyId },
    data: {
      aiKeyMode: KEY_MODES.includes(aiKeyMode) ? (aiKeyMode as any) : 'platform',
      activeProvider: PROVIDERS.includes(activeProvider) ? (activeProvider as any) : 'anthropic',
      activeModel
    }
  });
  revalidatePath('/app/settings');
}

async function updateApiKeys(formData: FormData) {
  'use server';
  const daraUser = await requireCompanyAdmin();
  const data: Record<string, string | null> = {};
  for (const [field, name] of [
    ['anthropicKeyEnc', 'anthropic'],
    ['openaiKeyEnc', 'openai'],
    ['googleKeyEnc', 'google']
  ] as const) {
    if (formData.get(`${name}_clear`) === 'on') {
      data[field] = null;
    } else {
      const val = String(formData.get(name) ?? '').trim();
      if (val) data[field] = encryptSecret(val);
    }
  }
  if (Object.keys(data).length > 0) {
    await prisma.company.update({ where: { id: daraUser.companyId }, data });
  }
  revalidatePath('/app/settings');
}

async function updateUser(formData: FormData) {
  'use server';
  const daraUser = await requireCompanyAdmin();
  const userId = String(formData.get('userId') ?? '');
  const target = await prisma.daraUser.findFirst({
    where: { id: userId, companyId: daraUser.companyId }
  });
  if (!target) return;
  const role = String(formData.get('role') ?? target.role);
  await prisma.daraUser.update({
    where: { id: userId },
    data: {
      role: ROLES.includes(role) ? (role as any) : target.role,
      isActive: formData.get('isActive') === 'on'
    }
  });
  revalidatePath('/app/settings');
}

export default async function SettingsPage() {
  const daraUser = await requireCompanyAdmin();
  const company = await prisma.company.findUnique({ where: { id: daraUser.companyId } });
  if (!company) redirect('/app/dashboard');

  const users = await prisma.daraUser.findMany({
    where: { companyId: daraUser.companyId },
    orderBy: { createdAt: 'asc' }
  });

  const keyHints = {
    anthropic: secretHint(company.anthropicKeyEnc),
    openai: secretHint(company.openaiKeyEnc),
    google: secretHint(company.googleKeyEnc)
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="text-sm text-[#7d97b3]">
          {company.name} · plan {company.plan} ({company.planStatus})
        </p>
      </div>

      {/* AI configuration */}
      <section className="rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">AI Configuration</h2>
        <form action={updateAIConfig} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className={labelClasses}>Key mode</label>
              <select name="aiKeyMode" defaultValue={company.aiKeyMode} className={fieldClasses}>
                {KEY_MODES.map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelClasses}>Provider</label>
              <select name="activeProvider" defaultValue={company.activeProvider} className={fieldClasses}>
                {PROVIDERS.map((p) => (<option key={p} value={p}>{p}</option>))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelClasses}>Model</label>
              <input name="activeModel" type="text" defaultValue={company.activeModel} className={fieldClasses} />
            </div>
          </div>
          <p className="text-xs text-[#7d97b3]">
            <strong>platform</strong> uses Crucible Insight&apos;s managed key;{' '}
            <strong>byok</strong> uses the keys you enter below.
          </p>
          <div className="flex justify-end">
            <button type="submit" className={primaryBtn}><Save className="h-4 w-4" />Save AI config</button>
          </div>
        </form>
      </section>

      {/* API keys */}
      <section className="rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-6">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-white">
          <KeyRound className="h-5 w-5 text-[#7d97b3]" />API Keys (BYOK)
        </h2>
        <p className="mb-4 text-xs text-[#7d97b3]">
          Stored encrypted (AES-256-GCM). Leave a field blank to keep the current
          key; tick “clear” to remove it.
        </p>
        <form action={updateApiKeys} className="space-y-4">
          {(['anthropic', 'openai', 'google'] as const).map((p) => (
            <div key={p} className="space-y-1.5">
              <label className={labelClasses}>
                {p} key{' '}
                {keyHints[p] ? (
                  <span className="ml-1 text-[#7de0a0]">set ({keyHints[p]})</span>
                ) : (
                  <span className="ml-1 text-[#7d97b3]">not set</span>
                )}
              </label>
              <div className="flex items-center gap-3">
                <input name={p} type="password" autoComplete="off" placeholder="Enter new key…" className={fieldClasses} />
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-[#7d97b3]">
                  <input type="checkbox" name={`${p}_clear`} className="h-4 w-4 rounded border-[#1a2f4a] bg-[#070c16]" />
                  clear
                </label>
              </div>
            </div>
          ))}
          <div className="flex justify-end">
            <button type="submit" className={primaryBtn}><Save className="h-4 w-4" />Save keys</button>
          </div>
        </form>
      </section>

      {/* Users */}
      <section className="rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Users className="h-5 w-5 text-[#7d97b3]" />Users{' '}
          <span className="text-sm font-normal text-[#7d97b3]">({users.length})</span>
        </h2>
        <div className="space-y-3">
          {users.map((u) => (
            <form key={u.id} action={updateUser} className="flex items-center gap-3 rounded-md border border-[#1a2f4a] bg-[#070c16] p-3">
              <input type="hidden" name="userId" value={u.id} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white">{u.name || u.email}</div>
                <div className="truncate text-xs text-[#7d97b3]">{u.email}</div>
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
