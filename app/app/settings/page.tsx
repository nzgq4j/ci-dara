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
import { getBillingOverview } from '@/utils/dara/billing';
import { getTrialUsage } from '@/utils/dara/trial';
import PageHeader from '@/components/dara/PageHeader';
import Tabs, { type TabDef } from '@/components/dara/Tabs';
import { card, btnGhost, sectionTitle } from '@/components/dara/theme';
import CompanyAIConfig from './CompanyAIConfig';
import ProfilePanel from '@/app/app/account/profile/ProfilePanel';
import PasswordPanel from '@/app/app/account/profile/PasswordPanel';
import SignInMethodsPanel from '@/app/app/account/profile/SignInMethodsPanel';
import TwoFactorPanel from '@/app/app/account/security/TwoFactorPanel';
import LegalCenter from '@/app/app/account/legal/LegalCenter';
import BillingView from '@/app/app/billing/BillingView';

const PROVIDERS = ['anthropic', 'openai', 'google'];
const KEY_MODES = ['platform', 'byok'];

async function requireUser() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  return daraUser;
}

async function updateAIConfig(formData: FormData) {
  'use server';
  const daraUser = await requireUser();
  if (daraUser.role !== 'company_admin') redirect('/app/dashboard');
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
  const daraUser = await requireUser();
  if (daraUser.role !== 'company_admin') redirect('/app/dashboard');
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
      // Field NAMES only — never the secret values.
      entityId: daraUser.companyId,
      metadata: { changed: Object.keys(data) }
    });
  }
  revalidatePath('/app/settings');
}

export default async function SettingsPage({
  searchParams
}: {
  searchParams: { tab?: string; success?: string };
}) {
  const daraUser = await requireUser();
  const isAdmin = daraUser.role === 'company_admin';

  const supabase = createClient();
  const [{ data: identityData }, { data: factors }] = await Promise.all([
    supabase.auth.getUserIdentities(),
    supabase.auth.mfa.listFactors()
  ]);
  const identities = (identityData?.identities ?? []).map((i) => ({
    identityId: i.identity_id ?? i.id,
    provider: i.provider,
    email: (i.identity_data?.email as string | undefined) ?? null
  }));
  const mfaEnabled = (factors?.totp ?? []).some((f) => f.status === 'verified');
  const backupRemaining = daraUser.mfaBackupCodes?.length ?? 0;

  const acceptedAt = daraUser.tosAcceptedAt
    ? new Date(daraUser.tosAcceptedAt).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    : null;

  const tabs: TabDef[] = [
    {
      id: 'profile',
      label: 'Profile',
      content: (
        <div className="mx-auto max-w-2xl space-y-6">
          <ProfilePanel name={daraUser.name} email={daraUser.email} avatarUrl={daraUser.avatarUrl} />
          <PasswordPanel />
          <SignInMethodsPanel identities={identities} />
        </div>
      )
    },
    {
      id: 'twofactor',
      label: 'Two-Factor',
      content: (
        <div className="mx-auto max-w-2xl">
          <TwoFactorPanel enabled={mfaEnabled} backupRemaining={backupRemaining} />
        </div>
      )
    },
    {
      id: 'legal',
      label: 'Legal',
      content: (
        <div className="mx-auto max-w-2xl">
          <LegalCenter acceptedVersion={daraUser.tosAcceptedVersion} acceptedAt={acceptedAt} />
        </div>
      )
    }
  ];

  if (isAdmin) {
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
    const overview = company.stripeSubId
      ? await getBillingOverview(company.stripeSubId, company.stripeCustomerId)
      : null;
    const trial = company.plan === 'trial' ? await getTrialUsage(daraUser.companyId) : null;

    tabs.push(
      {
        id: 'billing',
        label: 'Billing',
        content: (
          <div className="mx-auto max-w-4xl">
            <BillingView company={company} overview={overview} trial={trial} success={searchParams?.success} />
          </div>
        )
      },
      {
        id: 'ai',
        label: 'AI Configuration',
        content: (
          <div className="mx-auto max-w-3xl space-y-6">
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
        )
      }
    );
  }

  const requestedTab = searchParams?.tab;
  const initialTab = tabs.some((t) => t.id === requestedTab) ? requestedTab : tabs[0].id;

  return (
    <div className="fade">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        subtitle="Manage your profile, security, legal agreements, and organization configuration."
      />
      <Tabs tabs={tabs} initial={initialTab} />
    </div>
  );
}
