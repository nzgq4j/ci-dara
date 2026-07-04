'use client';

// Screen 4 — Upload & Instant Review. The low-friction Direct AI entry point: drop the
// solicitation (and your proposal draft), optionally add metadata, and one click creates the
// solicitation + kicks off the unified AI review. A "Switch to Color Team review" toggle
// under Advanced options routes to the existing P1/P2/P3 setup instead.
//
// Files are held in client state and posted to the server action as one FormData on submit
// (not via native file inputs) so the drag-drop and the "Browse" picker share one list and
// the two-step view is purely client-side. Colors use the app's semantic tokens (D5).

import { useRef, useState, useTransition } from 'react';
import { UploadCloud, FileText, CheckCircle2, X, ChevronDown } from 'lucide-react';
import { card, fieldClasses, labelClasses } from '@/components/dara/theme';

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
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rfpInput = useRef<HTMLInputElement>(null);
  const proposalInput = useRef<HTMLInputElement>(null);

  const addFiles = (setter: React.Dispatch<React.SetStateAction<File[]>>, list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    setter((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...incoming.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  };

  const removeFile = (setter: React.Dispatch<React.SetStateAction<File[]>>, idx: number) =>
    setter((prev) => prev.filter((_, i) => i !== idx));

  const hasFiles = rfpFiles.length > 0 || proposalFiles.length > 0;
  const canRun = colorTeam ? true : proposalFiles.length > 0; // Direct AI reviews the proposal draft

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

        {/* Drop zone (solicitation docs) */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(setRfpFiles, e.dataTransfer.files);
          }}
          className={`flex flex-col items-center justify-center rounded-[6px] border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragOver ? 'border-[#3b6ef0] bg-[#3b6ef0]/5' : 'border-line bg-bg'
          }`}
        >
          <UploadCloud className="h-6 w-6 text-t5" />
          <p className="mt-2 text-[15px] font-semibold text-t1">Drop solicitation files here</p>
          <p className="mt-0.5 text-[13px] text-t4">
            PDF, Word, or ZIP · Section L, M, and PWS auto-detected
          </p>
          <button
            type="button"
            onClick={() => rfpInput.current?.click()}
            className="mt-3 inline-flex items-center rounded-md border border-[#3b6ef0]/50 px-3 py-1.5 text-[12px] font-medium text-[#8fb0f5] transition-colors hover:bg-[#3b6ef0]/10"
          >
            Browse files
          </button>
          <input
            ref={rfpInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => addFiles(setRfpFiles, e.target.files)}
          />
        </div>

        {rfpFiles.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {rfpFiles.map((f, i) => (
              <FileRow key={`${f.name}-${i}`} name={f.name} onRemove={() => removeFile(setRfpFiles, i)} />
            ))}
          </ul>
        )}

        {/* Proposal draft uploader (what the Direct AI review grades) */}
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-semibold text-t2">Your proposal draft</div>
              <div className="text-[12px] text-t5">
                The Direct AI review scores this draft against the solicitation.
              </div>
            </div>
            <button
              type="button"
              onClick={() => proposalInput.current?.click()}
              className="inline-flex items-center rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-t4 transition-colors hover:border-[#3b6ef0]/50 hover:text-t1"
            >
              Add draft
            </button>
            <input
              ref={proposalInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => addFiles(setProposalFiles, e.target.files)}
            />
          </div>
          {proposalFiles.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {proposalFiles.map((f, i) => (
                <FileRow
                  key={`${f.name}-${i}`}
                  name={f.name}
                  onRemove={() => removeFile(setProposalFiles, i)}
                />
              ))}
            </ul>
          )}
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
                <span className="block text-[13px] font-semibold text-t2">
                  Switch to Color Team review
                </span>
                <span className="block text-[12px] text-t5">
                  Runs the multi-pass Pink / Red / Gold gate workflow instead of a single unified
                  AI review. You&apos;ll configure passes in the workspace.
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
              hasFiles ? 'bg-[#3b6ef0]' : 'bg-t5'
            }`}
          >
            2
          </span>
          <h2 className="text-[15px] font-semibold text-t1">
            {colorTeam ? 'Create & set up review' : 'Run AI Review'}
          </h2>
        </div>

        {!canRun && (
          <p className="mb-3 text-[12px] text-t5">
            {colorTeam
              ? 'Add your solicitation documents, then create the workspace.'
              : 'Add your proposal draft above — the Direct AI review scores it against the solicitation.'}
          </p>
        )}

        {error && (
          <p className="mb-3 rounded-md border border-[#5a1f1f]/60 bg-[#5a1f1f]/10 px-3 py-2 text-[12px] text-[#e88]">
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={!canRun || pending}
          onClick={submit}
          className="flex h-11 w-full items-center justify-center rounded-lg bg-[#3b6ef0] text-[14px] font-semibold text-white transition-colors hover:bg-[#2f5fd6] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? 'Uploading…' : colorTeam ? 'Create Solicitation' : 'Run AI Review'}
        </button>
        <p className="mt-2 text-center text-[12px] text-t5">
          {colorTeam
            ? 'Opens the workspace where you set up color-team passes.'
            : 'Review runs in the background. You can close this tab.'}
        </p>
      </div>
    </div>
  );
}

function FileRow({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-[#7de0a0]" />
      <FileText className="h-4 w-4 shrink-0 text-t5" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-t2">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded p-0.5 text-t5 transition-colors hover:text-[#e88]"
        aria-label={`Remove ${name}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
