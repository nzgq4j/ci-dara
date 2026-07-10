'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';

// Full requirement-detail modal for the compliance matrix. Clicking a requirement opens this and
// shows everything the shred captured: the verbatim requirement text, classification, the HRLR
// logic graph (state, satisfaction rule, evaluation scope), and full source provenance including
// the source DOCUMENT the requirement was extracted from. All fields are optional — a row shredded
// before HRLR (or added manually) simply omits the HRLR sections.
export type RequirementDetailData = {
  name: string;
  description: string;
  citation: string;
  source: string;
  disposition: string;
  farReference: string;
  complianceStatus: string;
  proposalRef: string;
  notes: string;
  // Source provenance.
  sourceDocument: string; // filename the requirement was extracted from ('' if unknown)
  sectionPath?: string;
  originalMarker?: string;
  page?: number | null;
  spanStart?: number | null;
  spanEnd?: number | null;
  verbatimVerified?: boolean;
  // HRLR logic graph.
  logicalId?: string;
  syntheticPath?: string;
  state?: string;
  composition?: string;
  mandatory?: string;
  satisfactionKind?: string;
  satisfactionN?: number | null;
  satisfactionBasis?: string;
  satisfactionRationale?: string;
  evalScope?: string;
  enumeratorCount?: number | null;
  applicability?: string;
  confidence?: string;
  confidenceRationale?: string;
  // Review signals.
  flags?: string[];
  fragmentStatus?: string;
  fragmentReason?: string;
  fragmentMergeCandidate?: string;
};

const STATUS_LABEL: Record<string, string> = {
  compliant: 'Compliant',
  partial: 'Partial',
  non_compliant: 'Missing',
  not_assessed: 'Not assessed',
  not_applicable: 'N/A'
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="grid grid-cols-[128px_1fr] gap-3 border-t border-line py-2 text-[12px]">
      <span className="font-mono text-[10px] uppercase tracking-wide text-t5">{label}</span>
      <span className="min-w-0 break-words text-t2">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-t4">{title}</h3>
      <div>{children}</div>
    </div>
  );
}

export default function RequirementDetail({
  detail,
  children
}: {
  detail: RequirementDetailData;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const d = detail;

  const satisfaction =
    d.satisfactionKind && d.satisfactionKind !== 'NONE'
      ? `${d.satisfactionKind}${d.satisfactionN ? ` (${d.satisfactionN})` : ''}` +
        (d.satisfactionBasis ? ` · ${d.satisfactionBasis}` : '')
      : '';

  const spans = d.spanStart != null && d.spanEnd != null ? `${d.spanStart}–${d.spanEnd}` : '';

  const hasProvenance =
    d.sourceDocument || d.sectionPath || d.originalMarker || d.page != null || spans || d.verbatimVerified !== undefined;
  const hasLogic =
    d.state || d.composition || d.mandatory || satisfaction || d.evalScope || d.applicability || d.confidence;
  const hasReviewSignals = (d.flags && d.flags.length > 0) || d.fragmentStatus;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="View full requirement details"
        className="block w-full text-left transition-colors hover:text-navy"
      >
        {children}
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setOpen(false)}
          >
            <div
              className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-line bg-surf p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    {d.syntheticPath && (
                      <span className="rounded bg-navy px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                        {d.syntheticPath}
                      </span>
                    )}
                    {d.citation && (
                      <span className="rounded bg-surf3 px-1.5 py-0.5 font-mono text-[10px] text-t3">
                        «{d.citation}»
                      </span>
                    )}
                    {d.logicalId && <span className="font-mono text-[10px] text-t5">{d.logicalId}</span>}
                  </div>
                  <h2 className="text-[15px] font-bold leading-snug text-t1">{d.name}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-shrink-0 text-t5 transition-colors hover:text-t2"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Verbatim requirement text */}
              {d.description && (
                <p className="whitespace-pre-wrap rounded-lg border border-line bg-bg px-3 py-2.5 text-[13px] leading-relaxed text-t3">
                  {d.description}
                </p>
              )}

              {/* Review signals — flags / probable mis-split — shown up top when present */}
              {hasReviewSignals && (
                <div className="mt-3 rounded-lg border border-[#92400E]/30 bg-[#FEF3C7]/30 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#92400E]">
                    <AlertTriangle className="h-3.5 w-3.5" /> Needs review
                  </div>
                  {d.fragmentStatus && (
                    <p className="mt-1 text-[12px] text-t2">
                      Probable mis-split ({d.fragmentReason})
                      {d.fragmentMergeCandidate ? ` — merge candidate ${d.fragmentMergeCandidate}` : ''}
                    </p>
                  )}
                  {d.flags?.map((f, i) => (
                    <p key={i} className="mt-1 text-[12px] text-t2">
                      • {f}
                    </p>
                  ))}
                </div>
              )}

              {/* Classification */}
              <Section title="Classification">
                <Field label="Source" value={d.source} />
                <Field label="Type" value={d.disposition} />
                <Field label="Mandatory" value={d.mandatory} />
                <Field label="FAR ref." value={d.farReference} />
                <Field label="Status" value={STATUS_LABEL[d.complianceStatus] ?? d.complianceStatus} />
                <Field label="Response loc." value={d.proposalRef} />
                <Field label="Notes" value={d.notes} />
              </Section>

              {/* Source & provenance */}
              {hasProvenance && (
                <Section title="Source & provenance">
                  <Field
                    label="Document"
                    value={
                      d.sourceDocument ? (
                        <span className="inline-flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 flex-shrink-0 text-t5" />
                          {d.sourceDocument}
                        </span>
                      ) : (
                        ''
                      )
                    }
                  />
                  <Field label="Section path" value={d.sectionPath} />
                  <Field label="Source marker" value={d.originalMarker} />
                  <Field label="Page" value={d.page != null ? String(d.page) : ''} />
                  <Field label="Char span" value={spans} />
                  <Field
                    label="Verbatim"
                    value={
                      d.verbatimVerified === undefined ? (
                        ''
                      ) : d.verbatimVerified ? (
                        <span className="inline-flex items-center gap-1 text-[#166534]">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Verified in source
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[#92400E]">
                          <AlertTriangle className="h-3.5 w-3.5" /> Not found in source
                        </span>
                      )
                    }
                  />
                </Section>
              )}

              {/* HRLR logic graph */}
              {hasLogic && (
                <Section title="Requirement logic">
                  <Field label="State" value={d.state} />
                  <Field label="Composition" value={d.composition} />
                  <Field label="Satisfaction" value={satisfaction} />
                  <Field label="Rationale" value={d.satisfactionRationale} />
                  <Field label="Eval scope" value={d.evalScope} />
                  <Field label="Children" value={d.enumeratorCount != null ? String(d.enumeratorCount) : ''} />
                  <Field label="Applicability" value={d.applicability} />
                  <Field
                    label="Confidence"
                    value={
                      d.confidence
                        ? d.confidence + (d.confidenceRationale ? ` — ${d.confidenceRationale}` : '')
                        : ''
                    }
                  />
                </Section>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
