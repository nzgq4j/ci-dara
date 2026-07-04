import { RefreshCw, Archive, ArchiveRestore, History, Loader2 } from 'lucide-react';
import ReviewSummary from './ReviewSummary';
import RationaleBlock from './RationaleBlock';
import ResultFindings from './ResultFindings';
import SubmitButton from './SubmitButton';
import { btnGhost } from './theme';

// One evaluation "section" = one criterion's result. Renders the review summary,
// rationale, structured findings, and the per-section controls: regenerate (with a
// regeneration count + prior-version log) and archive (retain, never delete).
export default function ResultCard({
  res,
  solId,
  regenerateAction,
  archiveAction
}: {
  res: any;
  solId: string;
  regenerateAction: (fd: FormData) => Promise<void>;
  archiveAction: (fd: FormData) => Promise<void>;
}) {
  const archived = !!res.archivedAt;
  const scoreLabel =
    res.aiScore != null ? `${Number(res.aiScore)}/100` : (res.aiDetermination ?? '—');
  const versions: any[] = Array.isArray(res.versions) ? res.versions : [];

  return (
    <div
      className={`rounded-lg border border-line bg-bg p-3 ${archived ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-t1">{res.requirement.name}</span>
          {res.regenCount > 0 && (
            <span className="rounded bg-line px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-t4">
              regen ×{res.regenCount}
            </span>
          )}
          {archived && (
            <span className="rounded bg-[#5a4a1f]/30 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-[#e0c97d]">
              archived
            </span>
          )}
        </div>
        <span className="text-[13px] text-navy">
          {scoreLabel}
          {res.aiConfidence != null && (
            <span className="ml-2 text-[11px] text-t5">
              {Math.round(Number(res.aiConfidence) * 100)}% conf.
            </span>
          )}
        </span>
      </div>

      <ReviewSummary review={res.aiReview} />

      <RationaleBlock rationale={res.aiRationale} />

      <ResultFindings
        strengths={res.aiStrengths}
        weaknesses={res.aiWeaknesses}
        compliance={res.aiCompliance}
        suggestedChanges={res.aiSuggestedChanges}
      />

      {/* Controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <form action={regenerateAction}>
          <input type="hidden" name="resultId" value={res.id.toString()} />
          <input type="hidden" name="solId" value={solId} />
          <SubmitButton
            className={`${btnGhost} !py-1.5 !text-[12px]`}
            pending={
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Regenerating…
              </>
            }
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate
          </SubmitButton>
        </form>

        <form action={archiveAction}>
          <input type="hidden" name="resultId" value={res.id.toString()} />
          <input type="hidden" name="solId" value={solId} />
          <input type="hidden" name="archived" value={archived ? '0' : '1'} />
          <SubmitButton className={`${btnGhost} !py-1.5 !text-[12px]`}>
            {archived ? (
              <>
                <ArchiveRestore className="h-3.5 w-3.5" />
                Restore
              </>
            ) : (
              <>
                <Archive className="h-3.5 w-3.5" />
                Archive
              </>
            )}
          </SubmitButton>
        </form>

        {versions.length > 0 && (
          <details className="ml-auto w-full sm:w-auto">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-t4 transition-colors hover:text-t1">
              <History className="h-3.5 w-3.5" />
              History ({versions.length})
            </summary>
            <div className="mt-2 space-y-2">
              {versions.map((v) => (
                <div
                  key={v.id.toString()}
                  className="rounded-lg border border-line bg-surf p-2.5"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono uppercase tracking-wide text-t5">
                      Version {v.version}
                      {v.modelId ? ` · ${v.modelId}` : ''}
                    </span>
                    <span className="text-navy">
                      {v.aiScore != null
                        ? `${Number(v.aiScore)}/100`
                        : (v.aiDetermination ?? '—')}
                    </span>
                  </div>
                  {v.aiRationale && (
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] leading-relaxed text-t4">
                      {v.aiRationale}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
