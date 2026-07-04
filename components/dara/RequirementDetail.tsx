'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// A "view full requirement" affordance for the dense compliance table: click the
// abridged description to open a modal with the complete requirement text, description,
// and citations — so the table stays compact without a truncating tooltip.
export default function RequirementDetail({
  abridged,
  name,
  description,
  citation,
  source,
  farReference,
  status,
  proposalRef,
  disposition
}: {
  abridged: string;
  name: string;
  description: string;
  citation: string;
  source: string;
  farReference: string;
  status: string;
  proposalRef: string;
  disposition: string;
}) {
  const [open, setOpen] = useState(false);

  const Row = ({ label, value }: { label: string; value: string }) =>
    value ? (
      <div className="grid grid-cols-[120px_1fr] gap-2 border-t border-line py-2 text-[12px]">
        <span className="font-mono text-[10px] uppercase tracking-wide text-t5">{label}</span>
        <span className="text-t2">{value}</span>
      </div>
    ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="View full requirement"
        className="block max-w-full truncate text-left text-[10px] text-t5 underline-offset-2 transition-colors hover:text-navy hover:underline"
      >
        {abridged || 'View details'}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-xl border border-line bg-surf p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-[15px] font-bold leading-snug text-t1">{name}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-shrink-0 text-t5 transition-colors hover:text-t2"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {description && (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-t3">{description}</p>
            )}

            <div className="mt-3">
              <Row label="Citation" value={citation} />
              <Row label="Source" value={source} />
              <Row label="FAR ref." value={farReference} />
              <Row label="Type" value={disposition} />
              <Row label="Status" value={status} />
              <Row label="Proposal ref" value={proposalRef} />
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
