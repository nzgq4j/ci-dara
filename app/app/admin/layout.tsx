import type { ReactNode } from 'react';
import { requirePlatformAdmin } from '@/utils/dara/platform';
import AdminNav from './AdminNav';

// Shared shell for every /app/admin route. Guards the whole subtree (defense in depth —
// each page also guards) and renders the sub-navigation once. Individual pages render their
// own PageHeader + content below the nav.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdmin();
  return (
    <div className="mx-auto max-w-5xl fade">
      <AdminNav />
      {children}
    </div>
  );
}
