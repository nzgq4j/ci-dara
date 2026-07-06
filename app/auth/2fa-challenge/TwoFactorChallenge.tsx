'use client';

import { useState } from 'react';
import { ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import {
  card,
  btnPrimary,
  fieldClasses,
  sectionTitle,
  monoLabel
} from '@/components/dara/theme';

export default function TwoFactorChallenge({ email }: { email: string }) {
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    setBusy(true);
    try {
      const body =
        mode === 'totp' ? { code } : { backupCode };
      const res = await fetch('/api/auth/2fa/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        throw new Error(
          mode === 'totp'
            ? 'That code didn’t match. Enter the current 6-digit code.'
            : 'That backup code isn’t valid or has already been used.'
        );
      }
      // Full navigation so the elevated (AAL2) session / recovery cookie is picked up.
      window.location.assign('/app/dashboard');
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  const canSubmit =
    mode === 'totp' ? code.length === 6 : backupCode.trim().length >= 8;

  return (
    <div className={`${card} w-full max-w-md p-7`}>
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-navy" />
        <h1 className={sectionTitle}>Two-factor verification</h1>
      </div>
      <p className="mb-5 text-[13px] leading-relaxed text-t4">
        {mode === 'totp' ? (
          <>Enter the 6-digit code from your authenticator app to finish signing in{email ? ` as ${email}` : ''}.</>
        ) : (
          <>Enter one of your single-use backup codes.</>
        )}
      </p>

      {mode === 'totp' ? (
        <>
          <label className={monoLabel} htmlFor="totp">
            Authentication code
          </label>
          <input
            id="totp"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => e.key === 'Enter' && canSubmit && submit()}
            className={`${fieldClasses} mt-1 text-center text-lg tracking-[0.4em]`}
            placeholder="123456"
          />
        </>
      ) : (
        <>
          <label className={monoLabel} htmlFor="backup">
            Backup code
          </label>
          <input
            id="backup"
            autoFocus
            autoComplete="one-time-code"
            value={backupCode}
            onChange={(e) => setBackupCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canSubmit && submit()}
            className={`${fieldClasses} mt-1 text-center font-mono tracking-widest`}
            placeholder="XXXXX-XXXXX"
          />
        </>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-[#991B1B]/30 bg-[#FEE2E2] px-3 py-2 text-[12px] text-[#991B1B]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy || !canSubmit}
        className={`${btnPrimary} mt-5 w-full`}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Verify
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'totp' ? 'backup' : 'totp');
          setError('');
        }}
        className="mt-4 block w-full text-center text-[12px] text-t4 underline transition-colors hover:text-t2"
      >
        {mode === 'totp' ? 'Use a backup code instead' : 'Use your authenticator app'}
      </button>
    </div>
  );
}
