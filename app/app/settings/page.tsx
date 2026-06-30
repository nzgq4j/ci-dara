import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { UsersRound } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { encryptSecret, secretHint } from '@/utils/dara/crypto';
import { getPlatformModelInfo } from '@/utils/dara/platform-ai';
import { recordAudit } from '@/utils/dara/audit';
import PageHeader from '@/components/dara/PageHeader';
import CompanyAIConfig from './CompanyAIConfig';
import { card, btnGhost, sectionTitle } from '@/components/dara/theme';

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

  return (
    <div className="mx-auto max-w-3xl fade">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        subtitle={`${company.name} · ${company.plan} (${company.planStatus})`}
      />

      <div className="space-y-6">
        {/* AI configuration + BYOK keys (non-BYOK accounts have no key/model choice) */}
        <CompanyAIConfig
          updateAIConfig={updateAIConfig}
          updateApiKeys={updateApiKeys}
          initialMode={company.aiKeyMode}
          provider={company.activeProvider}
          model={company.activeModel}
          platformProvider={platformAI.activeProvider}
          platformModel={platformAI.activeModel}
          keyHints={keyHints}
        />

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
