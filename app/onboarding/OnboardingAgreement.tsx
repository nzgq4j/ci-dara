'use client';

import { useState } from 'react';
import { Download, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { LEGAL_DOCS, LEGAL_VERSION, LEGAL_EFFECTIVE } from '@/utils/dara/legal-content';
import LegalDocument from '@/components/dara/LegalDocument';
import { acceptLegal } from './actions';
import { checkboxClasses } from '@/components/dara/theme';

// Onboarding Agreement step: view + download the legal docs, then accept via a single
// checkbox. Checking it immediately records acceptance (acceptLegal()), so the recorded
// date is the moment the box was checked. On success calls onSigned so the wizard can
// enable "Continue" — signing is required to finish onboarding.
export default function OnboardingAgreement({
  signed,
  onSigned
}: {
  signed: boolean;
  onSigned: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activeDoc, setActiveDoc] = useState(LEGAL_DOCS[0].id);

  const doc = LEGAL_DOCS.find((d) => d.id === activeDoc) ?? LEGAL_DOCS[0];

  async function onAgree(isChecked: boolean) {
    setError('');
    setChecked(isChecked);
    if (!isChecked) return;
    setBusy(true);
    const res = await acceptLegal();
    setBusy(false);
    if (!res.ok) {
      setChecked(false);
      setError(res.error || 'Could not record your acceptance.');
      return;
    }
    onSigned();
  }

  if (signed) {
    return (
      <div className="rounded-[10px] border border-[#166534]/30 bg-[#DCFCE7]/40 p-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[#166534]">
          <Check className="h-4 w-4" />
          Agreement accepted
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-t4">
          You accepted the Terms of Service &amp; Supplemental Policy Addendum (v{LEGAL_VERSION}).
          You can review these anytime under <span className="font-medium text-t3">Settings → Legal</span>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-[13px] leading-relaxed text-t4">
        Please review and accept our Terms of Service and Supplemental Policy Addendum
        (v{LEGAL_VERSION}, effective {LEGAL_EFFECTIVE}). You can download a copy for your
        records.
      </p>

      {/* Doc switcher + download */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {LEGAL_DOCS.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setActiveDoc(d.id)}
            className={`rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              d.id === activeDoc
                ? 'border-navy bg-navy/10 text-t1'
                : 'border-line bg-surf text-t4 hover:border-navy/40'
            }`}
          >
            {d.title}
          </button>
        ))}
        <a
          href={`/legal/${doc.file}`}
          download
          className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-medium text-navy hover:underline"
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </a>
      </div>

      {/* Scrollable full text */}
      <div className="max-h-72 overflow-y-auto rounded-[10px] border border-line bg-surf p-4">
        <LegalDocument body={doc.body} />
      </div>

      {/* Acceptance */}
      <div className="mt-4 rounded-[10px] border border-line bg-surf p-4">
        <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed text-t3">
          <input
            type="checkbox"
            checked={checked}
            disabled={busy}
            onChange={(e) => onAgree(e.target.checked)}
            className={`${checkboxClasses} mt-0.5`}
          />
          <span>
            I have read and agree to the Terms of Service and Supplemental Policy Addendum
            (v{LEGAL_VERSION}), and I am authorized to accept them on behalf of my
            organization.
          </span>
          {busy && <Loader2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin text-t4" />}
        </label>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-[#991B1B]/30 bg-[#FEE2E2] px-3 py-2 text-[12px] text-[#991B1B]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
