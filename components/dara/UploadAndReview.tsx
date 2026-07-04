'use client';

// Screen 4 — Upload & Instant Review, as a genuine two-step flow:
//   Step 1  Upload solicitation + proposal draft, metadata, Advanced (Color Team) toggle.
//           → [Continue] advances; [Cancel] leaves.
//   Step 2  Confirm what will be created, then [Run AI Review]/[Create Solicitation].
//           While submitting, a processing panel shows ingestion → creation → review-start
//           so it's clear work is happening. → [Back] returns to step 1.
//
// It ALWAYS creates the solicitation (a Direct AI review auto-runs only when a proposal draft
// is present). Files are held in client state (shared FileDropzone) and posted to the server
// action as one FormData. Colors use the app's semantic tokens (D5).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ArrowRight, ArrowLeft, Loader2, CheckCircle2, FileText } from 'lucide-react';
import { card, fieldClasses, labelClasses, btnGhost } from '@/components/dara/theme';
import FileDropzone from '@/components/dara/FileDropzone';

type CreateResult = { ok: boolean; error?: string; redirect?: string };

export default function UploadAndReview({
  action
}: {
  action: (formData: FormData) => Promise<CreateResult>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [rfpFiles, setRfpFiles] = useState<File[]>([]);
  const [proposalFiles, setProposalFiles] = useState<File[]>([]);
  const [solNumber, setSolNumber] = useState('');
  const [agency, setAgency] = useState('');
  const [naics, setNaics] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [colorTeam, setColorTeam] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Plain state (not useTransition): with an async op, useTransition's isPending flips back
  // to false after the synchronous part, which cleared the processing indicator and dropped
  // the post-await navigation. Real state stays true across the whole request.
  const [pending, setPending] = useState(false);

  const hasProposal = proposalFiles.length > 0;
  const canSubmit = rfpFiles.length > 0 || hasProposal || solNumber.trim() !== '';
  const willRun = !colorTeam && hasProposal;

  // Staged processing indicator while the server ingests + creates (+ starts the review). The
  // labels map to what the action actually does in sequence; the bar advances with each.
  const stages = willRun
    ? ['Uploading documents…', 'Extracting text…', 'Creating solicitation…', 'Starting AI review…']
    : ['Uploading documents…', 'Extracting text…', 'Creating solicitation…'];
  const [stageIdx, setStageIdx] = useState(0);
  useEffect(() => {
    if (!pending) {
      setStageIdx(0);
      return;
    }
    const timers = stages.map((_, i) => setTimeout(() => setStageIdx(i), i * 2200));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const submit = async () => {
    setError(null);
    setPending(true);
    const fd = new FormData();
    fd.set('mode', colorTeam ? 'color_team' : 'direct_ai');
    fd.set('solNumber', solNumber);
    fd.set('agency', agency);
    fd.set('naics', naics);
    fd.set('dueDate', dueDate);
    rfpFiles.forEach((f) => fd.append('rfpFiles', f));
    proposalFiles.forEach((f) => fd.append('proposalFiles', f));
    try {
      const res = await action(fd);
      if (res?.ok && res.redirect) {
        // Hard navigation guarantees the workflow moves forward into the workspace.
        window.location.assign(res.redirect);
        return; // keep the processing panel up through the navigation
      }
      setError(res?.error ?? 'Something went wrong. Please try again.');
    } catch {
      setError('The upload failed — your files may be too large, or the request timed out. Try fewer or smaller files.');
    }
    setPending(false);
  };

  const allFiles = [
    ...rfpFiles.map((f) => ({ f, kind: 'Solicitation' })),
    ...proposalFiles.map((f) => ({ f, kind: 'Proposal draft' }))
  ];

  // ---------- Step 1 — Upload ----------
  if (step === 1) {
    return (
      <div className={`${card} p-6`}>
        <div className="mb-3 flex items-center gap-2">
          <StepDot n={1} active />
          <h2 className="text-[15px] font-semibold text-t1">Upload solicitation document(s)</h2>
        </div>

        <FileDropzone
          files={rfpFiles}
          onChange={setRfpFiles}
          label="Drop solicitation files here"
          sub="PDF, Word, or text · Section L, M, and PWS auto-detected · max 20 MB"
        />

        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2">
            <div className="text-[13px] font-semibold text-t2">Your proposal draft</div>
            <div className="text-[12px] text-t5">
              {colorTeam
                ? 'The draft your color teams review (optional here — you can add it in the workspace).'
                : 'The Direct AI review scores this draft against the solicitation.'}
            </div>
          </div>
          <FileDropzone
            files={proposalFiles}
            onChange={setProposalFiles}
            label="Drop your proposal draft here"
            sub="PDF, Word, or text · max 20 MB"
            compact
          />
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="solNumber" className={labelClasses}>Solicitation Number</label>
            <input id="solNumber" value={solNumber} onChange={(e) => setSolNumber(e.target.value)} placeholder="e.g. FA8650-26-S-1841" className={fieldClasses} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="agency" className={labelClasses}>Agency</label>
            <input id="agency" value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="e.g. Air Force Research Lab" className={fieldClasses} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="naics" className={labelClasses}>NAICS</label>
            <input id="naics" value={naics} onChange={(e) => setNaics(e.target.value)} placeholder="e.g. 541715" className={fieldClasses} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="dueDate" className={labelClasses}>Due Date</label>
            <input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldClasses} />
          </div>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-t4 transition-colors hover:text-t1">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            Advanced review options
          </button>
          {showAdvanced && (
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-bg p-3">
              <input type="checkbox" checked={colorTeam} onChange={(e) => setColorTeam(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-line bg-bg accent-navy" />
              <span>
                <span className="block text-[13px] font-semibold text-t2">Switch to Color Team review</span>
                <span className="block text-[12px] text-t5">Runs the multi-pass Pink / Red / Gold gate workflow instead of a single unified AI review. You&apos;ll configure passes in the workspace.</span>
              </span>
            </label>
          )}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => setStep(2)}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-navy text-[14px] font-semibold text-white transition-colors hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue <ArrowRight className="h-4 w-4" />
          </button>
          <Link href="/app/solicitations" className={`${btnGhost} h-11`}>Cancel</Link>
        </div>
        {!canSubmit && (
          <p className="mt-2 text-[12px] text-t5">Add a document or a solicitation number to continue.</p>
        )}
      </div>
    );
  }

  // ---------- Step 2 — Confirm & run ----------
  return (
    <div className={`${card} p-6`}>
      <div className="mb-4 flex items-center gap-2">
        <StepDot n={2} active />
        <h2 className="text-[15px] font-semibold text-t1">{willRun ? 'Run AI Review' : 'Create solicitation'}</h2>
      </div>

      {/* What will be created */}
      <div className="rounded-lg border border-line bg-bg p-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.07em] text-t5">
          {colorTeam ? 'Color Team review' : 'Direct AI review'}
          {(solNumber || agency) ? ` · ${[solNumber, agency].filter(Boolean).join(' · ')}` : ''}
        </div>
        {allFiles.length === 0 ? (
          <p className="text-[13px] text-t5">No files attached — the solicitation will be created empty.</p>
        ) : (
          <ul className="space-y-1.5">
            {allFiles.map(({ f, kind }, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#166534]" />
                <FileText className="h-4 w-4 shrink-0 text-t5" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-t2">{f.name}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-t5">{kind}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 border-t border-line pt-3 text-[12px] text-t5">
          {willRun
            ? 'We’ll create the solicitation and run a unified AI review of your proposal against it.'
            : colorTeam
              ? 'We’ll create the solicitation and open the workspace to set up color-team passes.'
              : 'We’ll create the solicitation. Add a proposal draft in the workspace to run the AI review.'}
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-[#991B1B]/25 bg-[#FEE2E2] px-3 py-2 text-[12px] text-[#991B1B]">{error}</p>
      )}

      {/* Processing indicator OR action buttons */}
      {pending ? (
        <div className="mt-5 rounded-lg border border-navy/40 bg-navy/[0.04] px-4 py-4">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-navy">
            <Loader2 className="h-4 w-4 animate-spin" />
            {stages[stageIdx]}
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-line">
            <div
              className="h-full rounded bg-navy transition-all duration-700"
              style={{ width: `${Math.round(((stageIdx + 1) / stages.length) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-[12px] text-t5">Ingesting and processing your documents — this can take a moment.</p>
        </div>
      ) : (
        <>
          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-lg bg-navy text-[14px] font-semibold text-white transition-colors hover:bg-navy/90"
            >
              {willRun ? 'Run AI Review' : 'Create Solicitation'}
            </button>
            <button type="button" onClick={() => setStep(1)} className={`${btnGhost} h-11`}>
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
          </div>
          <p className="mt-2 text-[12px] text-t5">
            {willRun ? 'Review runs in the background. You can close this tab.' : 'Opens the workspace when it’s ready.'}
          </p>
        </>
      )}
    </div>
  );
}

function StepDot({ n, active }: { n: number; active?: boolean }) {
  return (
    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white ${active ? 'bg-navy' : 'bg-t5'}`}>
      {n}
    </span>
  );
}
