'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, Link2Off, Mail, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { card, btnGhost, btnDanger, sectionTitle } from '@/components/dara/theme';

type Identity = { identityId: string; provider: string; email: string | null };

const PROVIDER_LABEL: Record<string, string> = {
  email: 'Email & password',
  google: 'Google'
};

export default function SignInMethodsPanel({ identities }: { identities: Identity[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const hasGoogle = identities.some((i) => i.provider === 'google');
  const canUnlink = identities.length > 1;

  async function linkGoogle() {
    setError('');
    setBusy('link');
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?redirect_to=${encodeURIComponent(
        '/app/account/profile'
      )}`;
      const { error } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: { redirectTo }
      });
      if (error) throw error;
      // On success the browser is redirected to Google; nothing more to do here.
    } catch (e: any) {
      setError(
        e?.message?.includes('Manual linking')
          ? 'Account linking is not enabled yet. An administrator must turn on Manual Linking in Supabase.'
          : e?.message || 'Could not start Google linking.'
      );
      setBusy(null);
    }
  }

  async function unlink(provider: string) {
    setError('');
    setBusy(provider);
    try {
      const supabase = createClient();
      const { data, error: listErr } = await supabase.auth.getUserIdentities();
      if (listErr) throw listErr;
      const target = (data?.identities ?? []).find((i) => i.provider === provider);
      if (!target) throw new Error('Sign-in method not found.');
      const { error } = await supabase.auth.unlinkIdentity(target);
      if (error) throw error;
      router.refresh();
    } catch (e: any) {
      setError(e?.message || 'Could not remove that sign-in method.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`${card} p-6`}>
      <h2 className={`mb-1 flex items-center gap-2 ${sectionTitle}`}>
        <ShieldCheck className="h-4 w-4 text-navy" />
        Sign-in methods
      </h2>
      <p className="mb-4 text-[13px] leading-relaxed text-t4">
        Connect Google to sign in with one click, or keep using your email and password. You can use
        more than one — connecting Google doesn't remove your email sign-in.
      </p>

      <ul className="mb-4 divide-y divide-line rounded-lg border border-line">
        {identities.map((i) => (
          <li key={i.identityId} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2.5">
              {i.provider === 'google' ? (
                <GoogleGlyph />
              ) : (
                <Mail className="h-4 w-4 text-t4" />
              )}
              <div>
                <div className="text-sm font-medium text-t2">
                  {PROVIDER_LABEL[i.provider] ?? i.provider}
                </div>
                {i.email && <div className="text-[11px] text-t5">{i.email}</div>}
              </div>
            </div>
            {canUnlink && (
              <button
                type="button"
                onClick={() => unlink(i.provider)}
                disabled={busy !== null}
                className={btnDanger}
              >
                {busy === i.provider ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2Off className="h-4 w-4" />
                )}
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {!hasGoogle && (
        <button type="button" onClick={linkGoogle} disabled={busy !== null} className={btnGhost}>
          {busy === 'link' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="h-4 w-4" />
          )}
          Connect Google
        </button>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-[#991B1B]/30 bg-[#FEE2E2] px-3 py-2 text-[12px] text-[#991B1B]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
