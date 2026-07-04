'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signUp } from '@/utils/auth-helpers/server';
import { handleRequest } from '@/utils/auth-helpers/client';

interface SignUpProps {
  allowEmail: boolean;
  redirectMethod: string;
}

const inputCls =
  'w-full rounded-lg border border-line bg-surf2 px-3.5 py-2.5 text-t1 outline-none transition-colors focus:border-navy';
const labelCls =
  'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.04em] text-t4';

export default function SignUp({ allowEmail, redirectMethod }: SignUpProps) {
  const router = redirectMethod === 'client' ? useRouter() : null;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    setIsSubmitting(true);
    await handleRequest(e, signUp, router);
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
            placeholder="you@agency.gov"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect="off"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="password" className={labelCls}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••••••"
            autoComplete="new-password"
            className={inputCls}
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-navy py-3 text-[14px] font-bold tracking-tight text-white transition-colors hover:bg-navy/90 disabled:opacity-60"
        >
          {isSubmitting ? 'Creating account…' : 'Create Account'}
        </button>
      </form>

      <p className="mt-3 text-center text-[12px] text-t5">
        Free 14-day trial · you&apos;ll set up your workspace next.
      </p>

      <div className="mt-6 space-y-2 text-center text-[12px] text-t4">
        <div>
          Already have an account?{' '}
          <Link
            href="/signin/password_signin"
            className="font-semibold text-navy"
          >
            Sign in →
          </Link>
        </div>
        {allowEmail && (
          <div>
            <Link href="/signin/email_signin" className="text-navy">
              Sign in via magic link
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
