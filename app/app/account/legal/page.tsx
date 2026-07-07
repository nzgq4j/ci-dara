import { redirect } from 'next/navigation';

// Legal now lives as a tab under /app/settings.
export default function LegalPage() {
  redirect('/app/settings?tab=legal');
}
