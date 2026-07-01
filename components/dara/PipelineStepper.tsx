'use client';

import { useState, type ReactNode } from 'react';

export interface PipelineStage {
  id: string;
  num: number;
  label: string;
  sub: string;
  color: string; // hex accent for this stage
  view: string; // which view this stage shows
  done?: boolean; // advisory: has this stage had activity? (NOT a gate)
}

export interface PipelineTool {
  id: string;
  label: string;
  view: string;
  badge?: number;
}

// The color-review-cycle pipeline. It is a SUGGESTION, not a hard workflow — every
// stage is always clickable and skippable; the dots are advisory (✓ = has activity).
// Renders the active stage's view; all views are mounted so form state survives moves.
export default function PipelineStepper({
  stages,
  tools = [],
  views,
  initial
}: {
  stages: PipelineStage[];
  tools?: PipelineTool[];
  views: Record<string, ReactNode>;
  initial?: string;
}) {
  const [active, setActive] = useState(initial ?? stages[0]?.id);
  const activeEntry = [...stages, ...tools].find((e) => e.id === active);
  const activeView = activeEntry?.view ?? stages[0]?.view;

  return (
    <div>
      {/* Pipeline stepper */}
      <div className="no-print mb-4 overflow-x-auto rounded-lg border border-line bg-surf3">
        <div className="flex min-w-max items-stretch px-2 py-1.5">
          {stages.map((s, i) => {
            const on = s.id === active;
            const filled = on || s.done;
            return (
              <div key={s.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => setActive(s.id)}
                  className="flex flex-col items-center rounded-md border-b-2 px-3 py-2 transition-colors hover:bg-surf2"
                  style={{ borderColor: on ? s.color : 'transparent' }}
                >
                  <div className="mb-0.5 flex items-center gap-2">
                    <span
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold text-white ${filled ? '' : 'bg-line !text-t5'}`}
                      style={filled ? { background: s.color } : undefined}
                    >
                      {s.done ? '✓' : s.num}
                    </span>
                    <span
                      className={`whitespace-nowrap text-[11px] font-semibold ${on ? '' : 'text-t3'}`}
                      style={on ? { color: s.color } : undefined}
                    >
                      {s.label}
                    </span>
                  </div>
                  <span className="whitespace-nowrap text-[10px] text-t5">{s.sub}</span>
                </button>
                {i < stages.length - 1 && (
                  <div className="mt-[-14px] h-px w-4 flex-shrink-0 bg-line" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Cross-cutting tools (e.g. Amendments) */}
      {tools.length > 0 && (
        <div className="no-print mb-4 flex flex-wrap gap-2">
          {tools.map((t) => {
            const on = t.id === active;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  on ? 'border-[#3b6ef0] bg-[#3b6ef0]/5 text-t1' : 'border-line text-t4 hover:text-t2'
                }`}
              >
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className="rounded bg-line px-1.5 py-0.5 font-mono text-[10px] text-t4">{t.badge}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {Object.entries(views).map(([key, node]) => (
        <div key={key} className={key === activeView ? 'fade' : 'hidden'}>
          {node}
        </div>
      ))}
    </div>
  );
}
