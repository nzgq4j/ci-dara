'use client';

import { useState } from 'react';
import {
  Download,
  Check,
  AlertTriangle,
  Loader2,
  ShieldCheck
} from 'lucide-react';
import { LEGAL_DOCS, LEGAL_VERSION, LEGAL_EFFECTIVE } from '@/utils/dara/legal-content';
import LegalDocument from '@/components/dara/LegalDocument';
import { acceptLegal } from '@/app/onboarding/actions';
import { card, checkboxClasses, sectionTitle } from '@/components/dara/theme';

export default function LegalCenter({
  acceptedVersion,
  acceptedAt
}: {
  acceptedVersion: string | null;
  acceptedAt: string | null;
}) {
  const [ver, setVer] = useState(acceptedVersion);
  const [at, setAt] = useState(acceptedAt);

  const [activeDoc, setActiveDoc] = useState(LEGAL_DOCS[0].id);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const doc = LEGAL_DOCS.find((d) => d.id === activeDoc) ?? LEGAL_DOCS[0];
  const upToDate = ver === LEGAL_VERSION;

  async function onAgree(checked: boolean) {
    setError('');
    setAgree(checked);
    if (!checked) return;
    setBusy(true);
    const res = await acceptLegal();
    setBusy(false);
    if (!res.ok) {
      setAgree(false);
      setError(res.error || 'Could not record your acceptance.');
      return;
    }
    setVer(res.version ?? LEGAL_VERSION);
    setAt(
      new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    );
  }

  return (
    <div className="space-y-6">
      {/* Acceptance status */}
      <section className={`${card} p-5`}>
        {upToDate ? (
          <>
            <h2 className={`mb-1 flex items-center gap-2 ${sectionTitle}`}>
              <ShieldCheck className="h-4 w-4 text-[#166534]" />
              Terms accepted
            </h2>
            <p className="text-[13px] leading-relaxed text-t4">
              You accepted v{ver} of the Terms of Service &amp; Supplemental Policy Addendum
              {at ? <> on {at}</> : null}.
            </p>
          </>
        ) : (
          <>
            <h2 className={`mb-1 flex items-center gap-2 ${sectionTitle}`}>
              <AlertTriangle className="h-4 w-4 text-[#92400E]" />
              {ver ? 'A newer version needs your acceptance' : 'Terms not yet accepted'}
            </h2>
            <p className="text-[13px] leading-relaxed text-t4">
              {ver
                ? `You previously accepted v${ver}. The current version is v${LEGAL_VERSION} (effective ${LEGAL_EFFECTIVE}). Please review and re-accept below.`
                : `Please review and accept v${LEGAL_VERSION} (effective ${LEGAL_EFFECTIVE}) below.`}
            </p>
          </>
        )}
      </section>

      {/* Document viewer */}
      <section className={`${card} p-5`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
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
        <div className="max-h-[26rem] overflow-y-auto rounded-[10px] border border-line bg-bg p-4">
          <LegalDocument body={doc.body} />
        </div>
      </section>

      {/* Sign / re-accept */}
      {!upToDate && (
        <section className={`${card} p-5`}>
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-t2">
            <Check className="h-4 w-4 text-navy" />
            Accept v{LEGAL_VERSION}
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed text-t3">
            <input
              type="checkbox"
              checked={agree}
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
        </section>
      )}
    </div>
  );
}
