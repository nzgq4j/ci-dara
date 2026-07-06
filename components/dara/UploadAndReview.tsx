'use client';

// Screen 4 — Upload & Instant Review. Now a genuine THREE-screen flow:
//   Screen 0  Choose review type — two explanatory cards (Direct AI vs Color Team). This is
//             the FIRST thing after "New Solicitation" and it branches the rest of the wizard:
//             Direct AI uploads a response (proposal) draft now; Color Team does not.
//   Step 1    Upload solicitation (+ proposal draft for Direct AI) + metadata.
//             → [Continue] advances; [Cancel] leaves; [Change review type] returns to Screen 0.
//   Step 2    Confirm what will be created, then [Run AI Review]/[Create Solicitation].
//             While submitting, a processing panel shows ingestion → creation → review-start.
//
// It ALWAYS creates the solicitation (a Direct AI review auto-runs only when a proposal draft
// is present). Files are held in client state (shared FileDropzone) and posted to the server
// action one file per request (Vercel ~4.5 MB body cap). Colors use the app's semantic tokens.

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowLeft, Loader2, CheckCircle2, FileText, Sparkles, Users, Check } from 'lucide-react';
import { card, fieldClasses, labelClasses, btnGhost } from '@/components/dara/theme';
import FileDropzone from '@/components/dara/FileDropzone';

type ShellResult = { ok: boolean; error?: string; solId?: string };
type StepResult = { ok: boolean; error?: string; redirect?: string };
type Mode = 'direct_ai' | 'color_team';

// A single Vercel Function request body is capped near 4.5 MB, so we upload one file per
// request. Warn just under that so an oversized single file gets a clear message instead of a
// silent 413 mid-flow.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export default function UploadAndReview({
  createShell,
  uploadDoc,
  finalize
}: {
  createShell: (formData: FormData) => Promise<ShellResult>;
  uploadDoc: (formData: FormData) => Promise<StepResult>;
  finalize: (formData: FormData) => Promise<StepResult>;
}) {
  // mode === null → the path-selection screen (shown first). Choosing a card advances to step 1.
  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [rfpFiles, setRfpFiles] = useState<File[]>([]);
  const [proposalFiles, setProposalFiles] = useState<File[]>([]);
  const [solNumber, setSolNumber] = useState('');
  const [agency, setAgency] = useState('');
  const [naics, setNaics] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Plain state (not useTransition): with an async op, useTransition's isPending flips back
  // to false after the synchronous part, which cleared the processing indicator and dropped
  // the post-await navigation. Real state stays true across the whole request.
  const [pending, setPending] = useState(false);

  const colorTeam = mode === 'color_team';
  const hasProposal = proposalFiles.length > 0;
  const canSubmit = rfpFiles.length > 0 || hasProposal || solNumber.trim() !== '';
  const willRun = mode === 'direct_ai' && hasProposal;

  // Real progress across the three-step flow (create shell → upload each file → start review),
  // driven by actual completions rather than a timer. Total steps = 1 shell + N files + 1 start.
  const totalFiles = rfpFiles.length + proposalFiles.length;
  const totalSteps = totalFiles + 2;
  const [progress, setProgress] = useState<{ label: string; done: number }>({ label: '', done: 0 });

  // Any single file over the per-request ceiling would fail its own upload (a Function request
  // body is capped near 4.5 MB), so flag it up front instead of failing mid-flow.
  const oversized = [...rfpFiles, ...proposalFiles].filter((f) => f.size > MAX_FILE_BYTES);

  // Pick a review path. Color Team doesn't take a response draft during creation, so drop any
  // proposal files that were staged before a switch — they'd otherwise silently ride along.
  const choosePath = (m: Mode) => {
    setMode(m);
    setStep(1);
    setError(null);
    if (m === 'color_team') setProposalFiles([]);
  };

  const submit = async () => {
    if (!mode) return;
    setError(null);
    setPending(true);
    setProgress({ label: 'Creating solicitation…', done: 0 });
    let done = 0;
    try {
      // 1) Create the solicitation shell (metadata only — a tiny request).
      const meta = new FormData();
      meta.set('mode', mode);
      meta.set('solNumber', solNumber);
      meta.set('agency', agency);
      meta.set('naics', naics);
      meta.set('dueDate', dueDate);
      meta.set('titleHint', rfpFiles[0]?.name || proposalFiles[0]?.name || '');
      const shell = await createShell(meta);
      if (!shell.ok || !shell.solId) {
        setError(shell.error ?? 'Could not create the solicitation. Please try again.');
        setPending(false);
        return;
      }
      const solId = shell.solId;
      setProgress({ label: 'Solicitation created', done: ++done });

      // 2) Upload each file in its own request so no single request exceeds the body limit.
      const jobs = [
        ...rfpFiles.map((f) => ({ f, docType: 'rfp' as const })),
        ...proposalFiles.map((f) => ({ f, docType: 'proposal' as const }))
      ];
      for (const { f, docType } of jobs) {
        setProgress({ label: `Uploading ${f.name}…`, done });
        const fd = new FormData();
        fd.set('solId', solId);
        fd.set('docType', docType);
        fd.set('file', f);
        const res = await uploadDoc(fd);
        if (!res.ok) {
          setError(res.error ?? `Couldn’t upload ${f.name}. The solicitation was created — you can add this file from the workspace.`);
          setPending(false);
          return;
        }
        setProgress({ label: `Uploaded ${f.name}`, done: ++done });
      }

      // 3) Start the unified review (if applicable) and move into the workspace. finalize hands
      // back a workspace redirect even on a soft error, since the sol + docs already exist.
      setProgress({ label: willRun ? 'Starting AI review…' : 'Opening workspace…', done });
      const fin = new FormData();
      fin.set('solId', solId);
      fin.set('runReview', willRun ? '1' : '0');
      const finRes = await finalize(fin);
      const dest = finRes.redirect ?? `/app/solicitations/${solId}`;
      window.location.assign(dest); // hard nav; keep the panel up through navigation
      return;
    } catch {
      setError('Something went wrong — your session may have expired. Reload the page and try again.');
      setPending(false);
    }
  };

  const allFiles = [
    ...rfpFiles.map((f) => ({ f, kind: 'Solicitation' })),
    ...proposalFiles.map((f) => ({ f, kind: 'Proposal draft' }))
  ];

  // ---------- Screen 0 — Choose review type ----------
  if (mode === null) {
    return (
      <div>
        <div className="mb-4">
          <h2 className="text-[15px] font-semibold text-t1">How do you want this reviewed?</h2>
          <p className="mt-0.5 text-[13px] text-t4">
            Pick a path to start. You can change it before the solicitation is created.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <PathCard
            icon={<Sparkles className="h-5 w-5" />}
            title="Direct AI review"
            tagline="A one-click, unified AI read of your proposal draft against the solicitation."
            points={[
              'Upload the solicitation and your proposal draft now',
              'AI scores the draft, flags compliance gaps, and builds the matrix',
              'Results ready in minutes — best for a fast first read'
            ]}
            footer="You’ll upload response documents"
            onSelect={() => choosePath('direct_ai')}
          />
          <PathCard
            icon={<Users className="h-5 w-5" />}
            title="Color Team review"
            tagline="Structured gate reviews (Pink · Red · Gold …) as your proposal matures."
            points={[
              'Upload just the solicitation now — no response documents yet',
              'Set up review gates with your own personas in the workspace',
              'Attach each gate’s draft later, per review'
            ]}
            footer="No response documents needed yet"
            onSelect={() => choosePath('color_team')}
          />
        </div>

        <div className="mt-6">
          <Link href="/app/solicitations" className={`${btnGhost} h-11`}>Cancel</Link>
        </div>
      </div>
    );
  }

  // ---------- Step 1 — Upload ----------
  if (step === 1) {
    return (
      <div className={`${card} p-6`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <StepDot n={1} active />
            <h2 className="text-[15px] font-semibold text-t1">Upload solicitation document(s)</h2>
          </div>
          <button
            type="button"
            onClick={() => setMode(null)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-t4 transition-colors hover:text-t1"
          >
            {colorTeam ? <Users className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {colorTeam ? 'Color Team review' : 'Direct AI review'}
            <span className="text-t5">· Change</span>
          </button>
        </div>

        <FileDropzone
          files={rfpFiles}
          onChange={setRfpFiles}
          label="Drop solicitation files here"
          sub="PDF, Word, or text · Section L, M, and PWS auto-detected · max 20 MB"
        />

        {/* Response draft — Direct AI only. Color Team attaches per-review drafts later. */}
        {mode === 'direct_ai' && (
          <div className="mt-5 border-t border-line pt-4">
            <div className="mb-2">
              <div className="text-[13px] font-semibold text-t2">Your proposal draft</div>
              <div className="text-[12px] text-t5">
                The Direct AI review scores this draft against the solicitation.
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
        )}

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

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => setStep(2)}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-navy text-[14px] font-semibold text-white transition-colors hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue <ArrowRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setMode(null)} className={`${btnGhost} h-11`}>
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
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
              ? 'We’ll create the solicitation and open the workspace to set up color-team review gates.'
              : 'We’ll create the solicitation. Add a proposal draft in the workspace to run the AI review.'}
        </p>
      </div>

      {oversized.length > 0 && !pending && (
        <p className="mt-4 rounded-md border border-[#92400E]/25 bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#92400E]">
          {oversized.length === 1
            ? `“${oversized[0].name}” is over 4 MB and may fail to upload. Split or compress it, or add it from the workspace after creating.`
            : `${oversized.length} files are over 4 MB and may fail to upload. Split or compress them, or add them from the workspace after creating.`}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-[#991B1B]/25 bg-[#FEE2E2] px-3 py-2 text-[12px] text-[#991B1B]">{error}</p>
      )}

      {/* Processing indicator OR action buttons */}
      {pending ? (
        <div className="mt-5 rounded-lg border border-navy/40 bg-navy/[0.04] px-4 py-4">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-navy">
            <Loader2 className="h-4 w-4 animate-spin" />
            {progress.label || 'Working…'}
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-line">
            <div
              className="h-full rounded bg-navy transition-all duration-500"
              style={{ width: `${Math.round((progress.done / Math.max(totalSteps, 1)) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-[12px] text-t5">
            {totalFiles > 0 ? `Uploading ${totalFiles} document${totalFiles > 1 ? 's' : ''}, one at a time — this can take a moment.` : 'Setting up your solicitation…'}
          </p>
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

// A selectable review-path card for Screen 0. The whole card is the button.
function PathCard({
  icon,
  title,
  tagline,
  points,
  footer,
  onSelect
}: {
  icon: React.ReactNode;
  title: string;
  tagline: string;
  points: string[];
  footer: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex h-full flex-col rounded-[10px] border border-line bg-surf p-5 text-left transition-all hover:border-navy/50 hover:bg-navy/[0.03] hover:shadow-sm focus:outline-none focus-visible:border-navy focus-visible:ring-2 focus-visible:ring-navy/30"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy/10 text-navy">
        {icon}
      </div>
      <h3 className="mt-3 text-[15px] font-semibold text-t1">{title}</h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-t4">{tagline}</p>
      <ul className="mt-3 space-y-1.5">
        {points.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-t3">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-navy" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-t5">{footer}</span>
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-navy">
          Choose <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

function StepDot({ n, active }: { n: number; active?: boolean }) {
  return (
    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white ${active ? 'bg-navy' : 'bg-t5'}`}>
      {n}
    </span>
  );
}
