'use client';

import { useRouter } from 'next/navigation';
import { ShieldX, LogOut } from 'lucide-react';
import { SignOut } from '@/utils/auth-helpers/server';
import { handleRequest } from '@/utils/auth-helpers/client';
import { btnPrimary, card } from '@/components/dara/theme';

// Terminal screen for a deactivated (banned) account. Rendered instead of the app
// shell so there is no redirect loop; the only action is to sign out.
export default function AccountDisabled({ email }: { email: string }) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-t1">
      <div className={`${card} max-w-md p-8 text-center`}>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#FEE2E2] text-[#991B1B]">
          <ShieldX className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-t1">
          Account disabled
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-t4">
          Access for <span className="font-semibold text-t2">{email}</span> has been
          suspended by an administrator. Contact your administrator if you believe
          this is a mistake.
        </p>
        <form
          onSubmit={(e) => handleRequest(e, SignOut, router)}
          className="mt-7 flex justify-center"
        >
          <input type="hidden" name="pathName" value="/signin" />
          <button type="submit" className={btnPrimary}>
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
