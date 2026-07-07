import { redirect } from 'next/navigation';

// Profile now lives as a tab under /app/settings. Kept as a redirect because the
// Reset Password email template (supabase/templates/recovery.html) links here directly.
export default function AccountProfilePage() {
  redirect('/app/settings?tab=profile');
}
