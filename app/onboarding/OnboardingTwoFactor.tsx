'use client';

import { useState } from 'react';
import {
  KeyRound,
  ShieldCheck,
  Copy,
  Check,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import { btnPrimary, btnGhost, fieldClasses, monoLabel } from '@/components/dara/theme';

type SetupData = { factorId: string; secret: string; qr: string };

// Optional 2FA enrollment for the onboarding wizard. Reuses the same Supabase-MFA API
// routes as /app/account/security. On success it calls onEnabled() so the wizard can flip
// its "Skip" footer to "Continue"; the surrounding step owns Back / Skip / Continue.
export default function OnboardingTwoFactor({ onEnabled }: { onEnabled: () => void }) {
  const [phase, setPhase] = useState<'intro' | 'qr' | 'done'>('intro');
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function start() {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/2fa/setup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error === 'already_enabled'
            ? 'Two-factor is already enabled on this account.'
            : 'Could not start setup. Please try again.'
        );
      }
      setSetup(data);
      setCode('');
      setPhase('qr');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!setup) return;
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factorId: setup.factorId, code })
      });
      const data = await res.json();
      if (!res.ok) throw new Error('That code didn’t match. Enter the current 6-digit code.');
      setBackupCodes(data.backupCodes || []);
      setSetup(null);
      setPhase('done');
      onEnabled();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function copyBackup() {
    navigator.clipboard.writeText(backupCodes.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (phase === 'done') {
    return (
      <div className="rounded-[10px] border border-[#166534]/30 bg-[#DCFCE7]/40 p-4">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#166534]">
          <ShieldCheck className="h-4 w-4" />
          Two-factor is on — save your backup codes
        </div>
        <p className="mb-3 text-[12px] leading-relaxed text-t4">
          Store these somewhere safe. Each works <strong>once</strong> if you lose your
          authenticator. This is the only time they’re shown.
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-bg p-3 font-mono text-[12px] text-t1">
          {backupCodes.map((c) => (
            <div key={c} className="tracking-wider">
              {c}
            </div>
          ))}
        </div>
        <button type="button" onClick={copyBackup} className={`${btnGhost} mt-3`}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy codes'}
        </button>
      </div>
    );
  }

  if (phase === 'qr' && setup) {
    return (
      <div className="rounded-[10px] border border-line bg-surf p-4">
        <p className="mb-3 text-[13px] leading-relaxed text-t4">
          Scan this with Google Authenticator, Microsoft Authenticator, Authy, or any TOTP
          app — then enter the 6-digit code it shows.
        </p>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={setup.qr}
            alt="Two-factor QR code"
            className="h-40 w-40 flex-shrink-0 rounded-lg border border-line bg-white p-2"
          />
          <div className="min-w-0 flex-1">
            <div className={monoLabel}>Can’t scan? Enter this key</div>
            <div className="mb-3 mt-1 break-all rounded-md border border-line bg-bg px-3 py-2 font-mono text-[12px] text-t2">
              {setup.secret}
            </div>
            <label className={monoLabel} htmlFor="onb-totp">
              6-digit code
            </label>
            <input
              id="onb-totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${fieldClasses} mt-1 tracking-[0.3em]`}
              placeholder="123456"
            />
          </div>
        </div>
        {error && <ErrorNote msg={error} />}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={verify}
            disabled={busy || code.length !== 6}
            className={btnPrimary}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Verify &amp; enable
          </button>
          <button
            type="button"
            onClick={() => {
              setPhase('intro');
              setSetup(null);
              setError('');
            }}
            className={btnGhost}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // intro
  return (
    <div className="rounded-[10px] border border-line bg-surf p-4">
      <p className="mb-3 text-[13px] leading-relaxed text-t4">
        Add a time-based code from an authenticator app so a stolen password alone can’t
        reach your workspace. Recommended for accounts that handle CUI — you can also set
        this up later under <span className="font-medium text-t3">Two-Factor</span> in the
        sidebar.
      </p>
      {error && <ErrorNote msg={error} />}
      <button type="button" onClick={start} disabled={busy} className={`${btnPrimary} mt-1`}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        <KeyRound className="h-4 w-4" />
        Set up two-factor
      </button>
    </div>
  );
}

function ErrorNote({ msg }: { msg: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md border border-[#991B1B]/30 bg-[#FEE2E2] px-3 py-2 text-[12px] text-[#991B1B]">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <span>{msg}</span>
    </div>
  );
}
