import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Save, KeyRound, Cpu, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { encryptSecret, secretHint } from '@/utils/dara/crypto';
import { getPlatformModelInfo } from '@/utils/dara/platform-ai';
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

export default async function SettingsPage() {
  const daraUser = await requireCompanyAdmin();
  const company = await withTenant(daraUser.companyId, (tx) =>
    tx.company.findUnique({ where: { id: daraUser.companyId } })
  );
  if (!company) redirect('/app/dashboard');

  const keyHints = {
    anthropic: secretHint(company.anthropicKeyEnc),
    openai: secretHint(company.openaiKeyEnc),
    google: secretHint(company.googleKeyEnc)
  };
  const platformAI = await getPlatformModelInfo();
  const onPlatform = company.aiKeyMode === 'platform';

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
          {onPlatform && (
            <div className="mb-4 rounded-lg border border-[#3b6ef0]/30 bg-[#3b6ef0]/10 px-4 py-2.5 text-[12px] text-t3">
              On <strong className="text-t2">platform</strong> mode, evaluations use the
              platform-managed model:{' '}
              <span className="font-mono text-t2">{platformAI.activeProvider}</span> ·{' '}
              <span className="font-mono text-t2">{platformAI.activeModel}</span>. The
              provider and model below apply only when you switch to{' '}
              <strong className="text-t2">byok</strong> (your own key).
            </div>
          )}
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

        {/* Members moved to the Team page */}
        <section className={`${card} p-6`}>
          <h2 className={`mb-2 flex items-center gap-2 ${sectionTitle}`}>
            <UsersRound className="h-4 w-4 text-t5" />Members &amp; teams
          </h2>
          <p className="mb-4 text-[12px] text-t4">
            Inviting people, assigning roles, and organizing teams now live on the Team page.
          </p>
          <Link href="/app/team" className={btnGhost}><UsersRound className="h-4 w-4" />Go to Team</Link>
        </section>
      </div>
    </div>
  );
}
