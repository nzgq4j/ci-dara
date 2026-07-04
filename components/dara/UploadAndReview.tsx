'use client';

// Screen 4 — Upload & Instant Review. The low-friction entry point for BOTH modes: drop the
// solicitation (and, for Direct AI, your proposal draft), optionally add metadata, and one
// click creates the solicitation. Direct AI additionally kicks off the unified review when a
// proposal draft is present; the "Switch to Color Team review" toggle routes to the P1/P2/P3
// setup. It ALWAYS creates the solicitation (you can add a proposal later in the workspace).
//
// Files are held in client state (shared drag-drop via FileDropzone) and posted to the server
// action as one FormData on submit. Colors use the app's semantic tokens (D5).

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { card, fieldClasses, labelClasses, btnGhost } from '@/components/dara/theme';
import FileDropzone from '@/components/dara/FileDropzone';

type CreateResult = { ok: boolean; error?: string };

export default function UploadAndReview({
  action
}: {
  action: (formData: FormData) => Promise<CreateResult>;
}) {
  const [rfpFiles, setRfpFiles] = useState<File[]>([]);
  const [proposalFiles, setProposalFiles] = useState<File[]>([]);
  const [solNumber, setSolNumber] = useState('');
  const [agency, setAgency] = useState('');
  const [colorTeam, setColorTeam] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasProposal = proposalFiles.length > 0;
  // Always allow creating once there's something to create from.
  const canSubmit = rfpFiles.length > 0 || hasProposal || solNumber.trim() !== '';
  const willRun = !colorTeam && hasProposal;
  const ctaLabel = pending ? 'Working…' : willRun ? 'Run AI Review' : 'Create Solicitation';

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.set('mode', colorTeam ? 'color_team' : 'direct_ai');
    fd.set('solNumber', solNumber);
    fd.set('agency', agency);
    rfpFiles.forEach((f) => fd.append('rfpFiles', f));
    proposalFiles.forEach((f) => fd.append('proposalFiles', f));
    startTransition(async () => {
      const res = await action(fd);
      // On success the action redirects (navigation happens); only errors return here.
      if (res && !res.ok) setError(res.error ?? 'Something went wrong. Please try again.');
    });
  };

  return (
    <div className="space-y-5">
      {/* Step 1 — Upload */}
      <div className={`${card} p-6`}>
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#3b6ef0] text-[11px] font-bold text-white">
            1
          </span>
          <h2 className="text-[15px] font-semibold text-t1">Upload solicitation document(s)</h2>
        </div>

        <FileDropzone
          files={rfpFiles}
          onChange={setRfpFiles}
          label="Drop solicitation files here"
          sub="PDF, Word, or text · Section L, M, and PWS auto-detected · max 20 MB"
        />

        {/* Proposal draft uploader (what the Direct AI review grades) */}
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

        {/* Optional metadata */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="solNumber" className={labelClasses}>
              Solicitation Number
            </label>
            <input
              id="solNumber"
              value={solNumber}
              onChange={(e) => setSolNumber(e.target.value)}
              placeholder="e.g. FA8650-26-S-1841"
              className={fieldClasses}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="agency" className={labelClasses}>
              Agency
            </label>
            <input
              id="agency"
              value={agency}
              onChange={(e) => setAgency(e.target.value)}
              placeholder="e.g. Air Force Research Lab"
              className={fieldClasses}
            />
          </div>
        </div>

        {/* Advanced review options */}
        <div className="mt-5 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-t4 transition-colors hover:text-t1"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            Advanced review options
          </button>
          {showAdvanced && (
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-bg p-3">
              <input
                type="checkbox"
                checked={colorTeam}
                onChange={(e) => setColorTeam(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line bg-bg accent-[#3b6ef0]"
              />
              <span>
                <span className="block text-[13px] font-semibold text-t2">Switch to Color Team review</span>
                <span className="block text-[12px] text-t5">
                  Runs the multi-pass Pink / Red / Gold gate workflow instead of a single unified AI
                  review. You&apos;ll configure passes in the workspace.
                </span>
              </span>
            </label>
          )}
        </div>
      </div>

      {/* Step 2 — Confirm & run */}
      <div className={`${card} p-6`}>
        <div className="mb-3 flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white ${
              canSubmit ? 'bg-[#3b6ef0]' : 'bg-t5'
            }`}
          >
            2
          </span>
          <h2 className="text-[15px] font-semibold text-t1">{willRun ? 'Run AI Review' : 'Create solicitation'}</h2>
        </div>

        {error && (
          <p className="mb-3 rounded-md border border-[#5a1f1f]/60 bg-[#5a1f1f]/10 px-3 py-2 text-[12px] text-[#e88]">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!canSubmit || pending}
            onClick={submit}
            className="flex h-11 flex-1 items-center justify-center rounded-lg bg-[#3b6ef0] text-[14px] font-semibold text-white transition-colors hover:bg-[#2f5fd6] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {ctaLabel}
          </button>
          <Link href="/app/solicitations" className={`${btnGhost} h-11`}>
            Cancel
          </Link>
        </div>
        <p className="mt-2 text-[12px] text-t5">
          {colorTeam
            ? 'Opens the workspace where you set up color-team passes.'
            : willRun
              ? 'Review runs in the background. You can close this tab.'
              : 'Add a proposal draft above to run the AI review now — or create the solicitation and add it later in the workspace.'}
        </p>
      </div>
    </div>
  );
}
