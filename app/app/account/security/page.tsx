import { redirect } from 'next/navigation';

// Two-Factor now lives as a tab under /app/settings.
export default function AccountSecurityPage() {
  redirect('/app/settings?tab=twofactor');
}
