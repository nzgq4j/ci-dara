'use client';

import { useState } from 'react';
import { KeyRound, Check, AlertTriangle, Loader2 } from 'lucide-react';
import {
  card,
  btnPrimary,
  fieldClasses,
  sectionTitle,
  monoLabel
} from '@/components/dara/theme';
import { setPassword } from './actions';

export default function PasswordPanel() {
  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit() {
    setError('');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('password', password);
      fd.set('confirm', confirm);
      const res = await setPassword(fd);
      if (!res.ok) throw new Error(res.error);
      setDone(true);
      setPasswordValue('');
      setConfirm('');
      setTimeout(() => setDone(false), 3000);
    } catch (e: any) {
      setError(e.message || 'Could not update password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${card} p-6`}>
      <h2 className={`mb-1 flex items-center gap-2 ${sectionTitle}`}>
        <KeyRound className="h-4 w-4 text-navy" />
        Password
      </h2>
      <p className="mb-4 text-[13px] leading-relaxed text-t4">
        Set a password to sign in with your email, or change an existing one. If you joined by
        invitation or a magic link, setting a password here lets you sign in without waiting for a
        link each time.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={monoLabel} htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPasswordValue(e.target.value)}
            className={`${fieldClasses} mt-1`}
            placeholder="At least 8 characters"
          />
        </div>
        <div>
          <label className={monoLabel} htmlFor="confirm-password">
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`${fieldClasses} mt-1`}
            placeholder="Re-enter password"
          />
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-[#991B1B]/30 bg-[#FEE2E2] px-3 py-2 text-[12px] text-[#991B1B]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-5">
        <button
          type="button"
          onClick={submit}
          disabled={busy || password.length < 8 || confirm.length < 8}
          className={btnPrimary}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {done ? <Check className="h-4 w-4" /> : null}
          {done ? 'Password saved' : 'Save password'}
        </button>
      </div>
    </div>
  );
}
