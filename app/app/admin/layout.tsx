import type { ReactNode } from 'react';
import { requirePlatformAdmin } from '@/utils/dara/platform';

// Shared shell for every /app/admin route. Guards the whole subtree (defense in depth —
// each page also guards) and provides the max-width wrapper. Navigation lives in the
// PlatformAdminSidebar; individual pages render their own PageHeader + content.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdmin();
  return (
    <div className="mx-auto max-w-5xl fade">
      {children}
    </div>
  );
}
