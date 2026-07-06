'use client';

import { useState } from 'react';
import {
  ShieldCheck,
  ShieldOff,
  KeyRound,
  Copy,
  Check,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import {
  card,
  btnPrimary,
  btnGhost,
  btnDanger,
  fieldClasses,
  sectionTitle,
  monoLabel
} from '@/components/dara/theme';

type SetupData = { factorId: string; secret: string; qr: string };
type Phase = 'idle' | 'enrolling' | 'backup';

export default function TwoFactorPanel({
  enabled,
  backupRemaining
}: {
  enabled: boolean;
  backupRemaining: number;
}) {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [remaining, setRemaining] = useState(backupRemaining);
  const [phase, setPhase] = useState<Phase>('idle');
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const [disarm, setDisarm] = useState(false);
  const [disableCode, setDisableCode] = useState('');

  async function startSetup() {
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
      setPhase('enrolling');
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
      if (!res.ok) {
        throw new Error('That code didn’t match. Enter the current 6-digit code.');
      }
      setBackupCodes(data.backupCodes || []);
      setRemaining((data.backupCodes || []).length);
      setIsEnabled(true);
      setSetup(null);
      setPhase('backup');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: disableCode })
      });
      if (!res.ok) {
        throw new Error('That code didn’t match. Enter a current 6-digit code.');
      }
      setIsEnabled(false);
      setRemaining(0);
      setDisarm(false);
      setDisableCode('');
      setPhase('idle');
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

  // ── Backup codes just generated — show once ────────────────────────────────
  if (phase === 'backup') {
    return (
      <div className={`${card} p-6`}>
        <h2 className={`mb-1 flex items-center gap-2 ${sectionTitle}`}>
          <ShieldCheck className="h-4 w-4 text-[#166534]" />
          Two-factor is on — save your backup codes
        </h2>
        <p className="mb-4 text-[13px] leading-relaxed text-t4">
          Store these somewhere safe. Each code works <strong>once</strong> if you lose your
          authenticator. This is the only time they’re shown.
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-bg p-4 font-mono text-[13px] text-t1">
          {backupCodes.map((c) => (
            <div key={c} className="tracking-wider">
              {c}
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={copyBackup} className={btnGhost}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy codes'}
          </button>
          <button type="button" onClick={() => setPhase('idle')} className={btnPrimary}>
            I’ve saved them
          </button>
        </div>
      </div>
    );
  }

  // ── Enrolling — QR + verify ────────────────────────────────────────────────
  if (phase === 'enrolling' && setup) {
    return (
      <div className={`${card} p-6`}>
        <h2 className={`mb-1 flex items-center gap-2 ${sectionTitle}`}>
          <KeyRound className="h-4 w-4 text-navy" />
          Scan the QR code
        </h2>
        <p className="mb-4 text-[13px] leading-relaxed text-t4">
          Scan this with Google Authenticator, Microsoft Authenticator, Authy, or any TOTP
          app — then enter the 6-digit code it shows to finish.
        </p>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={setup.qr}
            alt="Two-factor QR code"
            className="h-44 w-44 flex-shrink-0 rounded-lg border border-line bg-white p-2"
          />
          <div className="min-w-0 flex-1">
            <div className={monoLabel}>Can’t scan? Enter this key</div>
            <div className="mb-4 mt-1 break-all rounded-md border border-line bg-bg px-3 py-2 font-mono text-[12px] text-t2">
              {setup.secret}
            </div>
            <label className={monoLabel} htmlFor="totp-code">
              6-digit code
            </label>
            <input
              id="totp-code"
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
        <div className="mt-5 flex items-center gap-3">
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
              setPhase('idle');
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

  // ── Idle — enabled or not ──────────────────────────────────────────────────
  return (
    <div className={`${card} p-6`}>
      {isEnabled ? (
        <>
          <h2 className={`mb-1 flex items-center gap-2 ${sectionTitle}`}>
            <ShieldCheck className="h-4 w-4 text-[#166534]" />
            Two-factor authentication is on
          </h2>
          <p className="mb-4 text-[13px] leading-relaxed text-t4">
            You’ll be asked for a 6-digit code from your authenticator app at sign-in.
            {remaining > 0
              ? ` ${remaining} backup code${remaining === 1 ? '' : 's'} remaining.`
              : ' No backup codes remaining — disable and re-enable to generate a new set.'}
          </p>

          {!disarm ? (
            <button type="button" onClick={() => setDisarm(true)} className={btnDanger}>
              <ShieldOff className="h-4 w-4" />
              Disable two-factor
            </button>
          ) : (
            <div className="rounded-lg border border-line bg-bg p-4">
              <label className={monoLabel} htmlFor="disable-code">
                Enter a current 6-digit code to disable
              </label>
              <input
                id="disable-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={disableCode}
                onChange={(e) =>
                  setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                className={`${fieldClasses} mt-1 max-w-[180px] tracking-[0.3em]`}
                placeholder="123456"
              />
              {error && <ErrorNote msg={error} />}
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={disable}
                  disabled={busy || disableCode.length !== 6}
                  className={btnDanger}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm disable
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDisarm(false);
                    setDisableCode('');
                    setError('');
                  }}
                  className={btnGhost}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <h2 className={`mb-1 flex items-center gap-2 ${sectionTitle}`}>
            <ShieldOff className="h-4 w-4 text-t5" />
            Two-factor authentication is off
          </h2>
          <p className="mb-4 text-[13px] leading-relaxed text-t4">
            Add a second factor so a stolen password alone can’t reach your workspace. Works
            with Google Authenticator, Microsoft Authenticator, Authy, and other TOTP apps.
          </p>
          {error && <ErrorNote msg={error} />}
          <button
            type="button"
            onClick={startSetup}
            disabled={busy}
            className={btnPrimary}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            <KeyRound className="h-4 w-4" />
            Enable two-factor
          </button>
        </>
      )}
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
