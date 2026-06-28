import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Save, KeyRound, Users, Cpu } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { encryptSecret, secretHint } from '@/utils/dara/crypto';
import { recordAudit } from '@/utils/dara/audit';
import PageHeader from '@/components/dara/PageHeader';
import CuiBoundaryNotice from '@/components/dara/CuiBoundaryNotice';
import {
  card,
  fieldClasses,
  labelClasses,
  checkboxClasses,
  btnPrimary,
  btnGhost,
  sectionTitle
} from '@/components/dara/theme';

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
  await withTenant(daraUser.companyId, (tx) =>
    tx.company.update({
      where: { id: daraUser.companyId },
      data: {
        aiKeyMode: KEY_MODES.includes(aiKeyMode) ? (aiKeyMode as any) : 'platform',
        activeProvider: PROVIDERS.includes(activeProvider) ? (activeProvider as any) : 'anthropic',
        activeModel
      }
    })
  );
  await recordAudit({
    action: 'aiconfig.update',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'company',
    entityId: daraUser.companyId,
    metadata: { aiKeyMode, activeProvider, activeModel }
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
    await withTenant(daraUser.companyId, (tx) =>
      tx.company.update({ where: { id: daraUser.companyId }, data })
    );
    await recordAudit({
      action: 'apikeys.update',
      companyId: daraUser.companyId,
      actorId: daraUser.id,
      actorEmail: daraUser.email,
      entityType: 'company',
      entityId: daraUser.companyId,
      // Field NAMES only — never the secret values.
      metadata: { changed: Object.keys(data) }
    });
  }
  revalidatePath('/app/settings');
}

async function updateUser(formData: FormData) {
  'use server';
  const daraUser = await requireCompanyAdmin();
  const userId = String(formData.get('userId') ?? '');
  await withTenant(daraUser.companyId, async (tx) => {
    const target = await tx.daraUser.findFirst({
      where: { id: userId, companyId: daraUser.companyId }
    });
    if (!target) return;
    const role = String(formData.get('role') ?? target.role);
    const newRole = ROLES.includes(role) ? role : target.role;
    const isActive = formData.get('isActive') === 'on';
    await tx.daraUser.update({
      where: { id: userId },
      data: { role: newRole as any, isActive }
    });
    await recordAudit({
      action: 'member.update',
      companyId: daraUser.companyId,
      actorId: daraUser.id,
      actorEmail: daraUser.email,
      entityType: 'user',
      entityId: userId,
      metadata: { role: newRole, isActive, fromRole: target.role }
    });
  });
  revalidatePath('/app/settings');
}

export default async function SettingsPage() {
  const daraUser = await requireCompanyAdmin();
  const { company, users } = await withTenant(daraUser.companyId, async (tx) => {
    const company = await tx.company.findUnique({ where: { id: daraUser.companyId } });
    const users = await tx.daraUser.findMany({
      where: { companyId: daraUser.companyId },
      orderBy: { createdAt: 'asc' }
    });
    return { company, users };
  });
  if (!company) redirect('/app/dashboard');

  const keyHints = {
    anthropic: secretHint(company.anthropicKeyEnc),
    openai: secretHint(company.openaiKeyEnc),
    google: secretHint(company.googleKeyEnc)
  };

  return (
    <div className="mx-auto max-w-3xl fade">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        subtitle={`${company.name} · ${company.plan} (${company.planStatus})`}
      />

      <div className="space-y-6">
        {/* AI configuration */}
        <section className={`${card} p-6`}>
          <h2 className={`mb-4 flex items-center gap-2 ${sectionTitle}`}>
            <Cpu className="h-4 w-4 text-t5" />AI Configuration
          </h2>
          <div className="mb-4">
            <CuiBoundaryNotice provider={company.activeProvider} mode={company.aiKeyMode} />
          </div>
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
            <p className="text-[12px] text-t4">
              <strong className="text-t2">platform</strong> uses Crucible Insight&apos;s managed key;{' '}
              <strong className="text-t2">byok</strong> uses the keys you enter below.
            </p>
            <div className="flex justify-end">
              <button type="submit" className={btnPrimary}><Save className="h-4 w-4" />Save AI config</button>
            </div>
          </form>
        </section>

        {/* API keys */}
        <section className={`${card} p-6`}>
          <h2 className={`mb-1 flex items-center gap-2 ${sectionTitle}`}>
            <KeyRound className="h-4 w-4 text-t5" />API Keys (BYOK)
          </h2>
          <p className="mb-4 text-[12px] text-t4">
            Stored encrypted (AES-256-GCM). Leave a field blank to keep the current
            key; tick &ldquo;clear&rdquo; to remove it.
          </p>
          <form action={updateApiKeys} className="space-y-4">
            {(['anthropic', 'openai', 'google'] as const).map((p) => (
              <div key={p} className="space-y-1.5">
                <label className={labelClasses}>
                  {p} key{' '}
                  {keyHints[p] ? (
                    <span className="ml-1 normal-case text-[#7de0a0]">set ({keyHints[p]})</span>
                  ) : (
                    <span className="ml-1 normal-case text-t5">not set</span>
                  )}
                </label>
                <div className="flex items-center gap-3">
                  <input name={p} type="password" autoComplete="off" placeholder="Enter new key…" className={fieldClasses} />
                  <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-t4">
                    <input type="checkbox" name={`${p}_clear`} className={checkboxClasses} />
                    clear
                  </label>
                </div>
              </div>
            ))}
            <div className="flex justify-end">
              <button type="submit" className={btnPrimary}><Save className="h-4 w-4" />Save keys</button>
            </div>
          </form>
        </section>

        {/* Users */}
        <section className={`${card} p-6`}>
          <h2 className={`mb-4 flex items-center gap-2 ${sectionTitle}`}>
            <Users className="h-4 w-4 text-t5" />Users{' '}
            <span className="font-mono text-[11px] font-normal text-t5">({users.length})</span>
          </h2>
          <div className="space-y-3">
            {users.map((u) => (
              <form key={u.id} action={updateUser} className="flex items-center gap-3 rounded-lg border border-line bg-bg p-3">
                <input type="hidden" name="userId" value={u.id} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-t1">{u.name || u.email}</div>
                  <div className="truncate text-[11px] text-t5">{u.email}</div>
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
