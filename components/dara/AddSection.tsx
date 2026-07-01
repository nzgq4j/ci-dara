'use client';

import { useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';

// An "add" affordance: shows a compact button until clicked, then reveals the form.
// Avoids leaving a permanent blank form/object at the end of a list. The form (a
// server-action form) is passed as children; after a create that redirects, the page
// reloads and this resets to the collapsed button.
export default function AddSection({
  label,
  children,
  className = ''
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3.5 py-2 text-[13px] font-medium text-t3 transition-colors hover:border-[#3b6ef0]/50 hover:text-t1 ${className}`}
      >
        <Plus className="h-4 w-4" />
        {label}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-[#3b6ef0]/40 bg-surf p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-t1">{label}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-t5 transition-colors hover:text-t2"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  );
}
