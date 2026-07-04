'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldAlert, X } from 'lucide-react';

const ACK_KEY = 'dara-cui-ack-v1';

// DARA-007 compensating control: the CUI → commercial-LLM data boundary, as a modal
// that surfaces once and can be permanently dismissed (per browser). A small chip
// keeps it re-openable so the notice is never fully lost. Copy is mode-aware.
export default function CuiBoundaryModal({ provider, mode }: { provider: string; mode: string }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (!localStorage.getItem(ACK_KEY)) setOpen(true);
    } catch {
      /* private mode / no storage — just don't auto-open */
    }
  }, []);

  if (!mounted) return null;

  const providerLabel =
    provider === 'anthropic' ? 'Anthropic' : provider === 'openai' ? 'OpenAI' : 'Google';
  const isByok = mode === 'byok';

  const dismissForever = () => {
    try {
      localStorage.setItem(ACK_KEY, '1');
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  return (
    <>
      {/* Persistent, unobtrusive re-open chip */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#92400E]/25 bg-[#FEF3C7] px-2.5 py-1 text-[11px] font-medium text-[#92400E] transition-colors hover:bg-[#FEF3C7]"
      >
        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
        CUI data boundary
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-[#92400E]/25 bg-surf p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FEF3C7] text-[#92400E]">
                  <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                </span>
                <h2 className="text-[15px] font-bold text-t1">CUI data boundary</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-t5 transition-colors hover:text-t2"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-[13px] leading-relaxed text-t3">
              Evaluations send the extracted text of solicitation and proposal documents —
              potentially <span className="font-semibold text-t2">FCI/CUI</span> — to{' '}
              <span className="font-semibold text-t2">{providerLabel}</span>, a commercial AI
              endpoint (not FedRAMP-authorized).{' '}
              {isByok
                ? 'You are using your own API key (BYOK) — your provider account’s data-handling and retention terms apply. Ensure zero data retention is configured for CUI.'
                : 'The DARA platform key processes data under DARA’s commercial account. For CUI, use BYOK with a zero-retention agreement, or confirm a zero-retention agreement covers the platform keys.'}
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <Link
                href="/app/security"
                className="text-[12px] font-medium text-navy underline-offset-2 hover:underline"
              >
                Details &amp; data-boundary policy →
              </Link>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-line px-3.5 py-1.5 text-[12px] font-medium text-t3 transition-colors hover:text-t1"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={dismissForever}
                  className="rounded-lg bg-navy px-3.5 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                >
                  I understand — don’t show again
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
