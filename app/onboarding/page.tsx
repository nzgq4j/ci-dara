import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import OnboardingWizard from './OnboardingWizard';

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com'
]);

// Suggest a company name from a corporate email domain (acme.com -> "Acme").
// Returns '' for free providers so we don't suggest "Gmail".
function suggestCompanyName(email: string): string {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return '';
  const label = domain.split('.')[0] || '';
  if (!label) return '';
  return label
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

// The org-creator onboarding wizard. Lives outside the /app shell (no sidebar) and
// is reached via the layout gate when a company has no onboardedAt. Prefills from
// the Google OAuth identity (name, avatar, email).
export default async function OnboardingPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');

  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');

  // Already set up — don't let anyone replay the wizard.
  if (daraUser.company.onboardedAt) redirect('/app/dashboard');

  const meta = (user.user_metadata ?? {}) as Record<string, any>;
  const email = daraUser.email || user.email || '';
  const prefillName =
    (meta.full_name || meta.name || daraUser.name || '').trim() ||
    email.split('@')[0];
  const avatarUrl: string | null = meta.avatar_url || meta.picture || null;

  // Prefer a real company name if one was already entered; otherwise suggest from
  // the email domain. The provisioned placeholder equals the email prefix, so we
  // treat that as "not yet named".
  const placeholder = email.split('@')[0];
  const existing = daraUser.company.name?.trim() || '';
  const suggestedCompany =
    existing && existing.toLowerCase() !== placeholder.toLowerCase()
      ? existing
      : suggestCompanyName(email);

  return (
    <OnboardingWizard
      email={email}
      prefillName={prefillName}
      avatarUrl={avatarUrl}
      suggestedCompany={suggestedCompany}
      initialAiMode={daraUser.company.aiKeyMode}
    />
  );
}
