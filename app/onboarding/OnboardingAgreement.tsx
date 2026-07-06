'use client';

import { useState } from 'react';
import { Download, Check, AlertTriangle, Loader2, PenLine } from 'lucide-react';
import { LEGAL_DOCS, LEGAL_VERSION, LEGAL_EFFECTIVE } from '@/utils/dara/legal-content';
import LegalDocument from '@/components/dara/LegalDocument';
import { acceptLegal } from './actions';
import {
  btnPrimary,
  fieldClasses,
  monoLabel,
  checkboxClasses
} from '@/components/dara/theme';

// Onboarding Agreement step: view + download the legal docs, then digitally sign (typed
// name + affirmative checkbox). Records acceptance via acceptLegal(); on success calls
// onSigned so the wizard can enable "Continue". Signing is required to finish onboarding.
export default function OnboardingAgreement({
  prefillName,
  signed,
  signedName,
  onSigned
}: {
  prefillName: string;
  signed: boolean;
  signedName: string;
  onSigned: (name: string) => void;
}) {
  const [name, setName] = useState(signedName || prefillName || '');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activeDoc, setActiveDoc] = useState(LEGAL_DOCS[0].id);

  const doc = LEGAL_DOCS.find((d) => d.id === activeDoc) ?? LEGAL_DOCS[0];

  async function sign() {
    setError('');
    if (!agree) {
      setError('Please check the box to confirm you agree.');
      return;
    }
    setBusy(true);
    const res = await acceptLegal(name);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || 'Could not record your acceptance.');
      return;
    }
    onSigned(name.trim());
  }

  if (signed) {
    return (
      <div className="rounded-[10px] border border-[#166534]/30 bg-[#DCFCE7]/40 p-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[#166534]">
          <Check className="h-4 w-4" />
          Agreement signed
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-t4">
          You accepted the Terms of Service &amp; Supplemental Policy Addendum (v{LEGAL_VERSION})
          {signedName ? (
            <>
              {' '}
              as <span className="font-medium text-t3">{signedName}</span>
            </>
          ) : null}
          . You can review these anytime under <span className="font-medium text-t3">Legal</span> in
          the sidebar.
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

      {/* Signature */}
      <div className="mt-4 rounded-[10px] border border-line bg-surf p-4">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-t2">
          <PenLine className="h-4 w-4 text-navy" />
          Sign to accept
        </div>
        <label className={monoLabel} htmlFor="sig-name">
          Full legal name (your signature)
        </label>
        <input
          id="sig-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${fieldClasses} mt-1`}
          placeholder="Jane Q. Contractor"
          autoComplete="name"
        />
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed text-t3">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className={`${checkboxClasses} mt-0.5`}
          />
          <span>
            I have read and agree to the Terms of Service and Supplemental Policy Addendum
            (v{LEGAL_VERSION}), and I am authorized to accept them on behalf of my
            organization.
          </span>
        </label>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-[#991B1B]/30 bg-[#FEE2E2] px-3 py-2 text-[12px] text-[#991B1B]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={sign}
          disabled={busy || !agree || name.trim().length < 2}
          className={`${btnPrimary} mt-4`}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Agree &amp; sign
        </button>
      </div>
    </div>
  );
}
