import { redirect } from 'next/navigation';

// Billing now lives as a tab under /app/settings. This redirect keeps old links/bookmarks
// (and the dashboard trial banner) working. See app/app/billing/{actions,BillingView}.tsx
// for the tab's server actions + presentational content.
export default function BillingPage({
  searchParams
}: {
  searchParams: { success?: string };
}) {
  redirect(`/app/settings?tab=billing${searchParams?.success ? '&success=1' : ''}`);
}
