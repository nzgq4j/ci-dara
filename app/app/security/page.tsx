import { redirect } from 'next/navigation';

// Security & Compliance is now a public page at /security (no sign-in required).
export default function AppSecurityPage() {
  redirect('/security');
}
