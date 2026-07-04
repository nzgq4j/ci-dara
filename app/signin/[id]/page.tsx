import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  getAuthTypes,
  getViewTypes,
  getDefaultSignInView,
  getRedirectMethod
} from '@/utils/auth-helpers/settings';
import PasswordSignIn from '@/components/ui/AuthForms/PasswordSignIn';
import EmailSignIn from '@/components/ui/AuthForms/EmailSignIn';
import Separator from '@/components/ui/AuthForms/Separator';
import OauthSignIn from '@/components/ui/AuthForms/OauthSignIn';
import ForgotPassword from '@/components/ui/AuthForms/ForgotPassword';
import UpdatePassword from '@/components/ui/AuthForms/UpdatePassword';
import SignUp from '@/components/ui/AuthForms/Signup';

const LOGIN_FEATURES = [
  'Structured FAR-based evaluation criteria',
  'Multi-persona AI scoring panels',
  'Compliance matrices and audit-ready reports'
];

const COPY: Record<string, { title: string; subtitle: string }> = {
  password_signin: { title: 'Sign in to DARA', subtitle: 'Access your company workspace' },
  email_signin: { title: 'Sign in to DARA', subtitle: 'We’ll email you a magic link' },
  forgot_password: { title: 'Reset password', subtitle: 'We’ll email you a reset link' },
  update_password: { title: 'Update password', subtitle: 'Choose a new password' },
  signup: { title: 'Create account', subtitle: 'Start your free 14-day trial' }
};

export default async function SignIn({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { disable_button: boolean };
}) {
  const { allowOauth, allowEmail, allowPassword } = getAuthTypes();
  const viewTypes = getViewTypes();
  const redirectMethod = getRedirectMethod();

  let viewProp: string;
  if (typeof params.id === 'string' && viewTypes.includes(params.id)) {
    viewProp = params.id;
  } else {
    const preferredSignInView =
      cookies().get('preferredSignInView')?.value || null;
    viewProp = getDefaultSignInView(preferredSignInView);
    return redirect(`/signin/${viewProp}`);
  }

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user && viewProp !== 'update_password') {
    return redirect('/');
  } else if (!user && viewProp === 'update_password') {
    return redirect('/signin');
  }

  const copy = COPY[viewProp] ?? COPY.password_signin;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left brand panel */}
      <div className="login-brand relative hidden w-[460px] flex-shrink-0 flex-col overflow-hidden p-12 md:flex">
        <div className="login-brand-glow pointer-events-none absolute inset-0" />
        <div className="relative z-10 flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/dara-logo.png" alt="DARA" className="h-10 w-10 object-contain" />
          <div>
            <div className="text-base font-bold tracking-tight text-white">DARA</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-gold">
              Crucible Insight
            </div>
          </div>
        </div>

        <div className="relative z-10 mt-auto">
          <div className="mb-4 text-[28px] font-bold leading-tight tracking-tight text-white">
            AI-powered proposal screening for acquisition professionals.
          </div>
          <div className="flex flex-col gap-3">
            {LOGIN_FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-2.5">
                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border border-gold/50 bg-gold/20 text-[11px] text-gold">
                  ✓
                </div>
                <span className="text-[13px] text-white/70">{f}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 mt-10 text-[11px] text-white/50">
          © 2026 Crucible Insight LLC · All rights reserved
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center overflow-y-auto bg-surf3 p-8">
        <div className="fade w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="mb-8 flex items-center gap-2.5 md:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/dara-logo.png" alt="DARA" className="h-9 w-9 object-contain" />
            <div className="text-base font-bold tracking-tight text-t1">DARA</div>
          </div>

          <div className="mb-1.5 text-[22px] font-bold tracking-tight text-t1">
            {copy.title}
          </div>
          <div className="mb-7 text-[13px] text-t4">{copy.subtitle}</div>

          {viewProp !== 'update_password' && allowOauth && (
            <div className="mb-2">
              <OauthSignIn />
            </div>
          )}

          {/* On the create-account view, separate the Google button from the
              email form. Google sign-up flows straight into onboarding with the
              user's name/avatar prefilled. */}
          {viewProp === 'signup' && allowOauth && (
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-line" />
              <span className="text-[11px] uppercase tracking-[0.06em] text-t5">
                or sign up with email
              </span>
              <div className="h-px flex-1 bg-line" />
            </div>
          )}

          {viewProp === 'password_signin' && (
            <PasswordSignIn allowEmail={allowEmail} redirectMethod={redirectMethod} />
          )}
          {viewProp === 'email_signin' && (
            <EmailSignIn
              allowPassword={allowPassword}
              redirectMethod={redirectMethod}
              disableButton={searchParams.disable_button}
            />
          )}
          {viewProp === 'forgot_password' && (
            <ForgotPassword
              allowEmail={allowEmail}
              redirectMethod={redirectMethod}
              disableButton={searchParams.disable_button}
            />
          )}
          {viewProp === 'update_password' && (
            <UpdatePassword redirectMethod={redirectMethod} />
          )}
          {viewProp === 'signup' && (
            <SignUp allowEmail={allowEmail} redirectMethod={redirectMethod} />
          )}
        </div>
      </div>
    </div>
  );
}
