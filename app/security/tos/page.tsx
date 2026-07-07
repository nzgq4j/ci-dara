import { redirect } from 'next/navigation';

// Terms of Service now lives as a tab on the public /legal page.
export default function TosPage() {
  redirect('/legal?tab=tos');
}
