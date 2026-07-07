import { redirect } from 'next/navigation';

// Privacy Policy now lives as a tab on the public /legal page.
export default function PrivacyPolicyPage() {
  redirect('/legal?tab=privacy');
}
