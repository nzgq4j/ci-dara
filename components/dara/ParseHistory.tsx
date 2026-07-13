'use client';

import { useState, useTransition } from 'react';
import { FileText, ChevronRight, RefreshCw, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { ParseResult } from '@/utils/dara/parse-result';

// Platform-admin-only parse-history viewer for a solicitation's documents. Renders the summary
// columns (cheap) up front; the full ParseResult JSONB is fetched on demand when a card is
// expanded (it can be 100KB+). Everything is null-safe — the Modal schema can evolve and older
// rows may lack newer fields, so the drawer must never crash on a missing value.

export interface ParseSummary {
  id: string;
  solDocId: string;
  docName: string;
  docType: string;
  parserVersion: string;
  schemaVersion: string;
  pageCount: number | null;
  wordCount: number | null;
  processingTimeMs: number | null;
  qualityGatePassed: boolean;
  qualityGateFailures: { gate: string; affected_pages: number[]; detail: string }[];
  modalCandidateCount: number | null;
  tableCount: number | null;
  ibrFlagCount: number | null;
  imagePageCount: number | null;
  createdAt: string; // ISO
  supersededAt: string | null; // ISO or null
}

// Deterministic UTC date+time — never toLocaleDateString (banned in SSR / hydration-unsafe).
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const s = new Date(iso).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)} UTC`;
}

function n(v: number | null | undefined): string {
  return v == null ? '—' : String(v);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[10px] uppercase tracking-wide text-t5">{label}</span>
      <span className="text-[13px] font-semibold text-t2">{value}</span>
    </div>
  );
}

export default function ParseHistory({
  solId,
  items,
  reparseAction,
  detailAction
}: {
  solId: string;
  items: ParseSummary[];
  reparseAction: (formData: FormData) => Promise<void>;
  detailAction: (parseId: string) => Promise<ParseResult | null>;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-bg p-4 text-[13px] text-t5">
        No structural parse records yet. Parsing runs automatically on document upload when the Modal
        parser is available; documents parsed only by the flat-text fallback have no record here.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((it) => (
        <ParseCard key={it.id} solId={solId} item={it} reparseAction={reparseAction} detailAction={detailAction} />
      ))}
    </div>
  );
}

function ParseCard({
  solId,
  item,
  reparseAction,
  detailAction
}: {
  solId: string;
  item: ParseSummary;
  reparseAction: (formData: FormData) => Promise<void>;
  detailAction: (parseId: string) => Promise<ParseResult | null>;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ParseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();

  const superseded = item.supersededAt != null;
  const gateOk = item.qualityGatePassed;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) {
      setLoading(true);
      try {
        const d = await detailAction(item.id);
        setDetail(d);
      } finally {
        setLoading(false);
        setLoaded(true);
      }
    }
  }

  return (
    <div
      className={`rounded-lg border ${superseded ? 'border-line bg-bg opacity-70' : 'border-line bg-surf'}`}
    >
      {/* Summary header */}
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <ChevronRight className={`h-4 w-4 flex-shrink-0 text-t5 transition-transform ${open ? 'rotate-90' : ''}`} />
        <FileText className="h-4 w-4 flex-shrink-0 text-t5" />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-medium text-t2">{item.docName}</span>
          <span className="rounded bg-line px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-t3">
            {item.docType}
          </span>
          {gateOk ? (
            <span className="inline-flex items-center gap-1 rounded bg-[#DCFCE7] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#166534]">
              <CheckCircle2 className="h-3 w-3" /> gate passed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-[#FEE2E2] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#991B1B]">
              <AlertTriangle className="h-3 w-3" /> gate failed ({item.qualityGateFailures?.length ?? 0})
            </span>
          )}
          {superseded && (
            <span className="rounded bg-line px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-t4">
              superseded
            </span>
          )}
        </span>
        <span className="hidden flex-shrink-0 items-center gap-1 text-[11px] text-t5 sm:flex">
          <Clock className="h-3 w-3" />
          {fmtDateTime(item.createdAt)}
        </span>
      </button>

      {/* Summary stat row */}
      <div className="grid grid-cols-3 gap-3 border-t border-line px-3 py-2.5 sm:grid-cols-6">
        <Stat label="Pages" value={n(item.pageCount)} />
        <Stat label="Words" value={n(item.wordCount)} />
        <Stat label="Obligations" value={n(item.modalCandidateCount)} />
        <Stat label="Tables" value={n(item.tableCount)} />
        <Stat label="IbR flags" value={n(item.ibrFlagCount)} />
        <Stat label="Image pages" value={n(item.imagePageCount)} />
      </div>

      {/* Detail drawer */}
      {open && (
        <div className="space-y-4 border-t border-line px-3 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-t5">
            <span>parser v{item.parserVersion}</span>
            <span>schema v{item.schemaVersion}</span>
            <span>
              {item.processingTimeMs != null ? `${(item.processingTimeMs / 1000).toFixed(1)}s parse` : 'time n/a'}
            </span>
            {superseded && <span>superseded {fmtDateTime(item.supersededAt)}</span>}
          </div>

          {/* Quality gate failures */}
          {item.qualityGateFailures?.length > 0 && (
            <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] p-2.5">
              <div className="mb-1 font-mono text-[10px] font-bold uppercase text-[#991B1B]">
                Quality gate failures
              </div>
              <ul className="space-y-1 text-[12px] text-[#7F1D1D]">
                {item.qualityGateFailures.map((f, i) => (
                  <li key={i}>
                    <span className="font-semibold">{f.gate}</span>
                    {f.affected_pages?.length ? ` (pages ${f.affected_pages.join(', ')})` : ''} — {f.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {loading && <div className="text-[12px] text-t5">Loading parse detail…</div>}
          {loaded && !detail && (
            <div className="text-[12px] text-t5">Parse detail unavailable.</div>
          )}
          {detail && <ParseDetail result={detail} />}

          {/* Re-parse (platform-admin only; the server action re-checks admin) */}
          {!superseded && (
            <form
              action={(fd) => startTransition(() => void reparseAction(fd))}
              className="flex justify-end"
            >
              <input type="hidden" name="solId" value={solId} />
              <input type="hidden" name="solDocId" value={item.solDocId} />
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg px-2.5 py-1.5 text-[12px] font-medium text-t2 transition-colors hover:bg-line disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} />
                {pending ? 'Queuing…' : 'Re-parse document'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// On-demand detail sub-panels rendered from the full ParseResult JSONB. Each guards its array.
function ParseDetail({ result }: { result: ParseResult }) {
  const sections = result.sections ?? [];
  const modals = result.modal_candidates ?? [];
  const tables = result.tables ?? [];
  const ibr = result.ibr_flags ?? [];
  const entities = result.named_entities ?? [];
  const imagePages = (result.pages ?? []).filter((p) => p?.image_only).map((p) => p.page_number);

  const entityGroups = entities.reduce<Record<string, number>>((acc, e) => {
    const k = e?.label || 'OTHER';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Sections */}
      {sections.length > 0 && (
        <Panel title={`Sections (${sections.length})`}>
          <ul className="space-y-0.5">
            {sections.slice(0, 60).map((s) => (
              <li key={s.section_id} className="text-[12px] text-t3" style={{ paddingLeft: `${Math.max(0, (s.heading_level || 1) - 1) * 12}px` }}>
                <span className="font-mono text-t5">{s.source_numbering || `H${s.heading_level ?? 1}`}</span>{' '}
                {(s.heading_text || '').slice(0, 120)}
              </li>
            ))}
            {sections.length > 60 && <li className="text-[11px] text-t5">…and {sections.length - 60} more</li>}
          </ul>
        </Panel>
      )}

      {/* Modal candidates */}
      {modals.length > 0 && (
        <Panel title={`Obligation candidates (${modals.length})`}>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-surf">
                <tr className="text-t5">
                  <th className="py-1 pr-2 font-medium">Source</th>
                  <th className="py-1 pr-2 font-medium">Modal</th>
                  <th className="py-1 pr-2 font-medium">Subject</th>
                  <th className="py-1 pr-2 font-medium">Conf.</th>
                </tr>
              </thead>
              <tbody>
                {modals.slice(0, 100).map((m) => (
                  <tr key={m.candidate_id} className="border-t border-line align-top">
                    <td className="py-1 pr-2 text-t2">
                      {(m.source_text || '').slice(0, 160)}
                      {m.is_passive && <span className="ml-1 rounded bg-line px-1 font-mono text-[8px] uppercase text-t4">passive</span>}
                    </td>
                    <td className="py-1 pr-2 font-mono text-t3">{m.modal_verb}</td>
                    <td className="py-1 pr-2 text-t3">
                      {m.subject || '—'}
                      {m.subject_inferred && <span className="ml-1 rounded bg-[#FEF3C7] px-1 font-mono text-[8px] uppercase text-[#92400E]">inferred</span>}
                    </td>
                    <td className="py-1 pr-2 font-mono text-t4">{m.svo_confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {modals.length > 100 && <div className="pt-1 text-[11px] text-t5">…and {modals.length - 100} more</div>}
          </div>
        </Panel>
      )}

      {/* Tables */}
      {tables.length > 0 && (
        <Panel title={`Tables (${tables.length})`}>
          <div className="space-y-2">
            {tables.slice(0, 12).map((t) => (
              <div key={t.table_id} className={`rounded border p-2 ${t.is_obligation_bearing ? 'border-[#FDE68A] bg-[#FFFBEB]' : 'border-line bg-bg'}`}>
                <div className="mb-1 flex items-center gap-2 font-mono text-[10px] text-t4">
                  <span>{t.table_id}</span>
                  {t.is_cdrl && <span className="rounded bg-[#DBEAFE] px-1 uppercase text-[#1E40AF]">CDRL</span>}
                  {t.is_obligation_bearing && <span className="rounded bg-[#FEF3C7] px-1 uppercase text-[#92400E]">obligation</span>}
                </div>
                <div className="mb-1 text-[11px] font-semibold text-t3">{(t.headers ?? []).join(' | ')}</div>
                <ul className="space-y-0.5">
                  {(t.rows ?? []).slice(0, 3).map((r, i) => (
                    <li key={i} className="text-[11px] text-t4">{(r.reconstructed_text || '').slice(0, 200)}</li>
                  ))}
                  {(t.rows ?? []).length > 3 && <li className="text-[10px] text-t5">…{(t.rows ?? []).length - 3} more rows</li>}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* IbR flags */}
      {ibr.length > 0 && (
        <Panel title={`Incorporation-by-reference citations (${ibr.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {ibr.slice(0, 60).map((f) => (
              <span key={f.flag_id} className="rounded bg-line px-1.5 py-0.5 font-mono text-[10px] text-t3">
                {f.citation_text} <span className="text-t5">({f.citation_type})</span>
              </span>
            ))}
          </div>
        </Panel>
      )}

      {/* Named entities */}
      {Object.keys(entityGroups).length > 0 && (
        <Panel title={`Named entities (${entities.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(entityGroups).map(([label, count]) => (
              <span key={label} className="rounded bg-line px-1.5 py-0.5 font-mono text-[10px] text-t3">
                {label}: {count}
              </span>
            ))}
          </div>
        </Panel>
      )}

      {/* Image-only pages */}
      {imagePages.length > 0 && (
        <Panel title={`Image-only pages (${imagePages.length})`}>
          <div className="text-[12px] text-t4">Pages {imagePages.join(', ')} had no extractable text layer.</div>
        </Panel>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-t4">{title}</div>
      {children}
    </div>
  );
}
