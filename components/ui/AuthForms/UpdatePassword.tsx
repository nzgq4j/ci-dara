'use client';

import { updatePassword } from '@/utils/auth-helpers/server';
import { handleRequest } from '@/utils/auth-helpers/client';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import React, { useState } from 'react';

interface UpdatePasswordProps {
  redirectMethod: string;
}

const inputCls =
  'w-full rounded-lg border border-line bg-surf2 px-3.5 py-2.5 pr-11 text-t1 outline-none transition-colors focus:border-navy';
const labelCls =
  'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.04em] text-t4';

// A password field whose reveal (eye) button only works WHILE the field is focused: clicking
// it toggles plain-text, but as soon as the field loses focus the value re-masks and the
// button goes inactive. onMouseDown preventDefault keeps the input focused when the button is
// clicked (so a click reveals rather than blurs), and onBlur resets both focus + reveal.
function PasswordField({ id, name, label }: { id: string; name: string; label: string }) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const show = focused && revealed;

  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={show ? 'text' : 'password'}
          placeholder="••••••••••••"
          autoComplete="new-password"
          className={inputCls}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setRevealed(false);
          }}
        />
        <button
          type="button"
          // Don't steal focus from the input — that would blur it and disable this button.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setRevealed((v) => !v)}
          disabled={!focused}
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-t4 transition-colors hover:text-t1 disabled:cursor-default disabled:opacity-30 disabled:hover:text-t4"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export default function UpdatePassword({ redirectMethod }: UpdatePasswordProps) {
  const router = redirectMethod === 'client' ? useRouter() : null;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    setIsSubmitting(true); // Disable the button while the request is being handled
    await handleRequest(e, updatePassword, router);
    setIsSubmitting(false);
  };

  return (
    <form noValidate onSubmit={(e) => handleSubmit(e)} className="space-y-3.5">
      <PasswordField id="password" name="password" label="New Password" />
      <PasswordField
        id="passwordConfirm"
        name="passwordConfirm"
        label="Confirm New Password"
      />
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-navy py-3 text-[14px] font-bold tracking-tight text-white transition-colors hover:bg-navy/90 disabled:opacity-60"
      >
        {isSubmitting ? 'Updating…' : 'Update Password'}
      </button>
    </form>
  );
}
