'use client';

import { Printer } from 'lucide-react';

// Triggers the browser print dialog. Print CSS (in styles/main.css) hides the app
// chrome (sidebar, pipeline nav, buttons marked .no-print) so only the content prints.
export default function PrintButton({
  label = 'Print',
  className
}: {
  label?: string;
  className?: string;
}) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      <Printer className="h-4 w-4" />
      {label}
    </button>
  );
}
