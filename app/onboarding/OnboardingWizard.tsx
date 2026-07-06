'use client';

import { useState, useTransition } from 'react';
import {
  Sparkles,
  User,
  Building2,
  Cpu,
  UsersRound,
  Check,
  ArrowRight,
  ArrowLeft,
  Plus,
  Trash2,
  ShieldCheck,
  KeyRound,
  Loader2
} from 'lucide-react';
import {
  btnPrimary,
  btnGhost,
  card,
  fieldClasses,
  labelClasses
} from '@/components/dara/theme';
import {
  saveProfile,
  saveOrganization,
  saveAiMode,
  completeOnboarding
} from './actions';
import { inviteUser } from '@/app/app/team/actions';
import OnboardingTwoFactor from './OnboardingTwoFactor';

type AiMode = 'platform' | 'byok';

interface InviteRow {
  email: string;
  role: string;
}

const STEPS = [
  { key: 'welcome', label: 'Welcome', icon: Sparkles },
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'org', label: 'Organization', icon: Building2 },
  { key: 'ai', label: 'AI', icon: Cpu },
  { key: 'team', label: 'Team', icon: UsersRound },
  { key: 'security', label: 'Security', icon: ShieldCheck },
  { key: 'done', label: 'Done', icon: Check }
] as const;

const INVITE_ROLES = [
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'manager', label: 'Manager' },
  { value: 'dept_admin', label: 'Department admin' },
  { value: 'company_admin', label: 'Company admin' }
];

export default function OnboardingWizard({
  email,
  prefillName,
  avatarUrl,
  suggestedCompany,
  initialAiMode
}: {
  email: string;
  prefillName: string;
  avatarUrl: string | null;
  suggestedCompany: string;
  initialAiMode: AiMode;
}) {
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(prefillName);
  const [company, setCompany] = useState(suggestedCompany);
  const [aiMode, setAiMode] = useState<AiMode>(initialAiMode);
  const [invites, setInvites] = useState<InviteRow[]>([
    { email: '', role: 'reviewer' }
  ]);
  const [mfaEnabled, setMfaEnabled] = useState(false);

  const firstName = (name || prefillName).split(' ')[0] || 'there';
  const initials = (name || email || '?').slice(0, 2).toUpperCase();

  const go = (n: number) => {
    setError(null);
    setStep(n);
  };

  // Run a server action, advance on success. `validate` returns an error string or null.
  const next = (
    action: (() => Promise<{ ok: boolean; error?: string }>) | null,
    to: number
  ) => {
    setError(null);
    if (!action) {
      go(to);
      return;
    }
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      go(to);
    });
  };

  const sendInvitesThenFinish = () => {
    setError(null);
    startTransition(async () => {
      const valid = invites
        .map((i) => ({ email: i.email.trim(), role: i.role }))
        .filter((i) => i.email && i.email.includes('@'));
      for (const i of valid) {
        // Best-effort: a single bad invite shouldn't block finishing onboarding.
        try {
          await inviteUser(i.email, i.role, null);
        } catch {
          /* ignore */
        }
      }
      await completeOnboarding(); // redirects to /app/dashboard
    });
  };

  const finishNoInvites = () => {
    setError(null);
    startTransition(async () => {
      await completeOnboarding();
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-t1">
      <div className="w-full max-w-xl">
        {/* Brand */}
        <div className="mb-6 flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/dara-logo.png"
            alt="DARA"
            className="h-8 w-8 object-contain"
          />
          <span className="text-sm font-bold tracking-tight text-t1">DARA</span>
        </div>

        {/* Stepper */}
        <div className="mb-6 flex items-center gap-1.5">
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div key={s.key} className="flex flex-1 items-center gap-1.5">
                <div
                  className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border text-[11px] font-bold transition-colors ${
                    active
                      ? 'border-navy bg-navy text-white'
                      : done
                        ? 'border-navy/40 bg-navy/15 text-navy'
                        : 'border-line bg-surf text-t5'
                  }`}
                  title={s.label}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`h-px flex-1 ${done ? 'bg-navy/40' : 'bg-line'}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className={`${card} p-7`}>
          {/* Step 1 — Welcome */}
          {step === 0 && (
            <div className="fade text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-navy to-gold text-lg font-bold text-white">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials
                )}
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-t1">
                Welcome to DARA, {firstName}
              </h1>
              <p className="mx-auto mt-2 max-w-sm text-sm text-t4">
                Let&apos;s set up your workspace. This takes about a minute — your
                profile, your organization, and how you want to run AI evaluations.
              </p>
              <div className="mt-7 flex justify-center">
                <button
                  className={btnPrimary}
                  onClick={() => go(1)}
                  type="button"
                >
                  Get started
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — Profile */}
          {step === 1 && (
            <div className="fade">
              <StepHead
                icon={User}
                title="Your profile"
                subtitle="This is how teammates will see you."
              />
              <div className="space-y-4">
                <div>
                  <label className={labelClasses}>Display name</label>
                  <input
                    className={`${fieldClasses} mt-1.5`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    autoFocus
                  />
                </div>
                <div>
                  <label className={labelClasses}>Email</label>
                  <input
                    className={`${fieldClasses} mt-1.5 cursor-not-allowed opacity-60`}
                    value={email}
                    readOnly
                    disabled
                  />
                </div>
              </div>
              <NavRow
                onBack={() => go(0)}
                onNext={() => next(() => saveProfile(name), 2)}
                pending={pending}
                error={error}
              />
            </div>
          )}

          {/* Step 3 — Organization */}
          {step === 2 && (
            <div className="fade">
              <StepHead
                icon={Building2}
                title="Your organization"
                subtitle="Name your workspace. You can change this later in Settings."
              />
              <div>
                <label className={labelClasses}>Company name</label>
                <input
                  className={`${fieldClasses} mt-1.5`}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Acme Government Solutions"
                  autoFocus
                />
              </div>
              <NavRow
                onBack={() => go(1)}
                onNext={() => next(() => saveOrganization(company), 3)}
                pending={pending}
                error={error}
              />
            </div>
          )}

          {/* Step 4 — AI configuration */}
          {step === 3 && (
            <div className="fade">
              <StepHead
                icon={Cpu}
                title="AI configuration"
                subtitle="How should DARA run evaluations? You can switch this anytime in Settings."
              />
              <div className="space-y-3">
                <ModeCard
                  active={aiMode === 'platform'}
                  onClick={() => setAiMode('platform')}
                  icon={ShieldCheck}
                  title="Use the DARA platform key"
                  desc="Zero setup — run evaluations on our managed models right away."
                  note="Note: solicitation text is sent to a commercial LLM provider. Avoid pasting CUI; bring your own key for the strictest data boundary."
                />
                <ModeCard
                  active={aiMode === 'byok'}
                  onClick={() => setAiMode('byok')}
                  icon={KeyRound}
                  title="Bring your own key"
                  desc="Use your own Anthropic / OpenAI / Google key for full control of the data boundary."
                  note="You'll add your encrypted key in Settings after setup."
                />
              </div>
              <NavRow
                onBack={() => go(2)}
                onNext={() => next(() => saveAiMode(aiMode), 4)}
                pending={pending}
                error={error}
              />
            </div>
          )}

          {/* Step 5 — Invite team */}
          {step === 4 && (
            <div className="fade">
              <StepHead
                icon={UsersRound}
                title="Invite your team"
                subtitle="Add teammates by email — or skip and invite them later from the Team page."
              />
              <div className="space-y-2.5">
                {invites.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className={fieldClasses}
                      value={row.email}
                      onChange={(e) =>
                        setInvites((rows) =>
                          rows.map((r, j) =>
                            j === i ? { ...r, email: e.target.value } : r
                          )
                        )
                      }
                      placeholder="teammate@company.com"
                      type="email"
                    />
                    <select
                      className={`${fieldClasses} w-[150px] flex-shrink-0`}
                      value={row.role}
                      onChange={(e) =>
                        setInvites((rows) =>
                          rows.map((r, j) =>
                            j === i ? { ...r, role: e.target.value } : r
                          )
                        )
                      }
                    >
                      {INVITE_ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="flex-shrink-0 rounded-md border border-line p-2 text-t5 transition-colors hover:text-[#dc2626]"
                      onClick={() =>
                        setInvites((rows) =>
                          rows.length > 1 ? rows.filter((_, j) => j !== i) : rows
                        )
                      }
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-navy transition-colors hover:text-navy"
                  onClick={() =>
                    setInvites((rows) => [...rows, { email: '', role: 'reviewer' }])
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add another
                </button>
              </div>

              {error && <p className="mt-4 text-[13px] text-[#991B1B]">{error}</p>}

              <div className="mt-7 flex items-center justify-between">
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => go(3)}
                  disabled={pending}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => go(5)}
                    disabled={pending}
                  >
                    Skip for now
                  </button>
                  <button
                    type="button"
                    className={btnPrimary}
                    onClick={() => next(null, 5)}
                    disabled={pending}
                  >
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 6 — Security (2FA, optional) */}
          {step === 5 && (
            <div className="fade">
              <StepHead
                icon={ShieldCheck}
                title="Two-factor authentication"
                subtitle="Optional but recommended — add a second factor to protect access to CUI."
              />
              <OnboardingTwoFactor onEnabled={() => setMfaEnabled(true)} />
              <div className="mt-7 flex items-center justify-between">
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => go(4)}
                  disabled={pending}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
                <button
                  type="button"
                  className={mfaEnabled ? btnPrimary : btnGhost}
                  onClick={() => go(6)}
                  disabled={pending}
                >
                  {mfaEnabled ? 'Continue' : 'Skip for now'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 7 — Done */}
          {step === 6 && (
            <div className="fade text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#DCFCE7] text-[#166534]">
                <Check className="h-8 w-8" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-t1">
                You&apos;re all set
              </h1>
              <p className="mx-auto mt-2 max-w-sm text-sm text-t4">
                {company ? (
                  <>
                    <span className="font-semibold text-t2">{company}</span> is ready.
                  </>
                ) : (
                  'Your workspace is ready.'
                )}{' '}
                Create your first solicitation and run an evaluation to see DARA in
                action.
              </p>
              {error && <p className="mt-4 text-[13px] text-[#991B1B]">{error}</p>}
              <div className="mt-7 flex justify-center gap-2">
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => go(5)}
                  disabled={pending}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={
                    invites.some((i) => i.email.trim().includes('@'))
                      ? sendInvitesThenFinish
                      : finishNoInvites
                  }
                  disabled={pending}
                >
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Go to dashboard
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepHead({
  icon: Icon,
  title,
  subtitle
}: {
  icon: typeof User;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-navy/15 text-navy">
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div>
        <h2 className="text-lg font-bold tracking-tight text-t1">{title}</h2>
        <p className="mt-0.5 text-[13px] text-t4">{subtitle}</p>
      </div>
    </div>
  );
}

function NavRow({
  onBack,
  onNext,
  pending,
  error
}: {
  onBack: () => void;
  onNext: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <>
      {error && <p className="mt-4 text-[13px] text-[#991B1B]">{error}</p>}
      <div className="mt-7 flex items-center justify-between">
        <button
          type="button"
          className={btnGhost}
          onClick={onBack}
          disabled={pending}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <button
          type="button"
          className={btnPrimary}
          onClick={onNext}
          disabled={pending}
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Continue
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}

function ModeCard({
  active,
  onClick,
  icon: Icon,
  title,
  desc,
  note
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof User;
  title: string;
  desc: string;
  note: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-[10px] border p-4 text-left transition-colors ${
        active
          ? 'border-navy bg-navy/10'
          : 'border-line bg-surf hover:border-navy/40'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
            active ? 'bg-navy text-white' : 'bg-line text-t4'
          }`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-t1">{title}</span>
            {active && (
              <Check className="h-4 w-4 flex-shrink-0 text-navy" />
            )}
          </div>
          <p className="mt-1 text-[13px] text-t4">{desc}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-t5">{note}</p>
        </div>
      </div>
    </button>
  );
}
