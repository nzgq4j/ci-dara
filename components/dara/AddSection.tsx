'use client';

import { useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';

// An "add" affordance: a compact button that opens the form in a MODAL — never a
// persistent blank card/object in the list. The form (a server-action form) is passed
// as children. After a create that redirects, the page reloads and this resets.
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3.5 py-2 text-[13px] font-medium text-t3 transition-colors hover:border-[#3b6ef0]/50 hover:text-t1 ${className}`}
      >
        <Plus className="h-4 w-4" />
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-line bg-surf p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-t1">{label}</h2>
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
        </div>
      )}
    </>
  );
}
