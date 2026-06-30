'use client';

import Link from 'next/link';
import { signInWithPassword } from '@/utils/auth-helpers/server';
import { handleRequest } from '@/utils/auth-helpers/client';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

interface PasswordSignInProps {
  allowEmail: boolean;
  redirectMethod: string;
}

const inputCls =
  'w-full rounded-lg border border-line bg-surf2 px-3.5 py-2.5 text-t1 outline-none transition-colors focus:border-[#3b6ef0]';
const labelCls =
  'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.04em] text-t4';

export default function PasswordSignIn({
  allowEmail,
  redirectMethod
}: PasswordSignInProps) {
  const router = redirectMethod === 'client' ? useRouter() : null;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [remember, setRemember] = useState(true);

  // Pre-fill the remembered email (Option A). Only runs client-side.
  useEffect(() => {
    const saved = localStorage.getItem('dara-remember-email');
    if (saved) setEmail(saved);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    setIsSubmitting(true);
    if (remember) localStorage.setItem('dara-remember-email', email);
    else localStorage.removeItem('dara-remember-email');
    await handleRequest(e, signInWithPassword, router);
    setIsSubmitting(false);
  };

  return (
    <div>
      <form noValidate onSubmit={(e) => handleSubmit(e)} className="space-y-3.5">
        <div>
          <label htmlFor="email" className={labelCls}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@agency.gov"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect="off"
            className={inputCls}
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className={labelCls + ' mb-0'}>
              Password
            </label>
            <Link
              href="/signin/forgot_password"
              className="text-[12px] text-[#3b6ef0]"
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••••••"
            autoComplete="current-password"
            className={inputCls}
          />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-t4">
          <input
            type="checkbox"
            name="remember"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded border-line bg-surf2 accent-[#3b6ef0]"
          />
          Remember me on this device
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-[#3b6ef0] py-3 text-[14px] font-bold tracking-tight text-white transition-colors hover:bg-[#2f5fd6] disabled:opacity-60"
        >
          {isSubmitting ? 'Signing in…' : 'Sign In'}
        </button>
      </form>

      <div className="mt-6 space-y-2 text-center text-[12px] text-t4">
        {allowEmail && (
          <div>
            <Link href="/signin/email_signin" className="text-[#3b6ef0]">
              Sign in via magic link
            </Link>
          </div>
        )}
        <div>
          Don&apos;t have an account?{' '}
          <Link
            href="/signin/signup"
            className="font-semibold text-[#3b6ef0]"
          >
            Create Account →
          </Link>
        </div>
      </div>
    </div>
  );
}
