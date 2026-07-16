'use client';

// Strength Guide — Section B of the FSEA pipeline output.
//
// Renders all identified strength opportunities with their evidence requirements
// and writing briefs. Users mark each SO as confirmed, partial, or absent.
// Status updates save immediately via server action.

import { useState, useTransition } from 'react';
import { TrendingUp, AlertCircle, CheckCircle2, MinusCircle, XCircle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { card, eyebrow } from '@/components/dara/theme';
import type { P8StrengthOpportunity, P10StrengthRegisterEntry } from '@/utils/dara/fsea/types';

type SOStatus = 'to_be_confirmed' | 'confirmed' | 'partial' | 'absent';

export interface StrengthGuideProps {
  sectionB: P10StrengthRegisterEntry[];
  criticalGapAdvisory?: string | null;
  top5?: { rank: number; soId: string; paragraph: string; impact: string }[];
  solId: string;
  saveStatusAction?: (fd: FormData) => Promise<{ ok: boolean }>;
}

const STATUS_CONFIG: Record<SOStatus, {
  label: string;
  color: string;
  bg: string;
  icon: React.ReactNode;
}> = {
  to_be_confirmed: { label: 'To confirm', color: 'text-t4', bg: 'bg-surf3', icon: <AlertCircle className="h-3 w-3" /> },
  confirmed:       { label: 'Confirmed',  color: 'text-[#166534]', bg: 'bg-[#DCFCE7]', icon: <CheckCircle2 className="h-3 w-3" /> },
  partial:         { label: 'Partial',    color: 'text-[#92400E]', bg: 'bg-[#FEF3C7]', icon: <MinusCircle className="h-3 w-3" /> },
  absent:          { label: 'Absent',     color: 'text-[#991B1B]', bg: 'bg-[#FEE2E2]', icon: <XCircle className="h-3 w-3" /> },
};

const PRIORITY_CHIP = 'inline-flex items-center rounded bg-navy/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-navy';
const PARA_CHIP = 'inline-flex items-center rounded bg-surf3 px-1.5 py-0.5 font-mono text-[9px] text-t4';

function StatusButton({
  soId,
  current,
  status,
  onClick,
  disabled,
}: {
  soId: string;
  current: SOStatus;
  status: SOStatus;
  onClick: (s: SOStatus) => void;
  disabled?: boolean;
}) {
  const cfg = STATUS_CONFIG[status];
  const isActive = current === status;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick(status)}
      className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
        isActive
          ? `${cfg.bg} ${cfg.color}`
          : 'bg-surf3 text-t5 hover:bg-surf2 hover:text-t2'
      }`}
    >
      {cfg.icon}
      {cfg.label}
    </button>
  );
}

function SOCard({
  so,
  rank,
  status,
  onStatusChange,
  saving,
}: {
  so: P10StrengthRegisterEntry;
  rank?: number;
  status: SOStatus;
  onStatusChange: (soId: string, status: SOStatus) => void;
  saving?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cfg = STATUS_CONFIG[status];

  return (
    <div className={`${card} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {rank && (
              <span className={PRIORITY_CHIP}>
                <TrendingUp className="mr-1 h-2.5 w-2.5" />
                #{rank}
              </span>
            )}
            <span className={PARA_CHIP}>{so.paragraph}</span>
            <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold ${cfg.bg} ${cfg.color}`}>
              {cfg.icon}
              {cfg.label}
            </span>
          </div>
          <p className="mt-1 text-[13px] font-semibold text-t1">{so.soId}</p>
          <p className="mt-0.5 text-[11.5px] text-t4">{so.requirement}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-t5" />}
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="text-t5 hover:text-t2"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Status buttons */}
      <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-2.5">
        {(['to_be_confirmed', 'confirmed', 'partial', 'absent'] as SOStatus[]).map(s => (
          <StatusButton
            key={s}
            soId={so.soId}
            current={status}
            status={s}
            onClick={(newStatus) => onStatusChange(so.soId, newStatus)}
            disabled={saving}
          />
        ))}
      </div>

      {/* Detail panel */}
      {open && (
        <div className="divide-y divide-line/60 border-t border-line">
          <div className="px-4 py-3">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-t5">Threshold (compliance floor)</p>
            <p className="text-[12px] text-t3">{so.threshold}</p>
          </div>
          <div className="px-4 py-3">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-t5">Strength description</p>
            <p className="text-[12px] text-t2">{so.strengthDescription}</p>
          </div>
          <div className="px-4 py-3">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-t5">Evidence required</p>
            <p className="text-[12px] text-t3">{so.evidenceRequired}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StrengthGuide({
  sectionB,
  criticalGapAdvisory,
  top5,
  solId,
  saveStatusAction,
}: StrengthGuideProps) {
  const [statuses, setStatuses] = useState<Record<string, SOStatus>>(() => {
    const init: Record<string, SOStatus> = {};
    for (const so of sectionB) init[so.soId] = so.status ?? 'to_be_confirmed';
    return init;
  });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleStatusChange = (soId: string, status: SOStatus) => {
    setStatuses(prev => ({ ...prev, [soId]: status }));
    if (!saveStatusAction) return;
    setSavingId(soId);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('solId', solId);
      fd.set('soId', soId);
      fd.set('status', status);
      await saveStatusAction(fd).catch(() => null);
      setSavingId(null);
    });
  };

  if (!sectionB || sectionB.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-line bg-surf px-6 py-12 text-center">
        <TrendingUp className="h-8 w-8 text-t5" />
        <p className="mt-3 text-[13px] text-t4">
          No strength opportunities identified yet. Run the pipeline to generate the Strength Guide.
        </p>
      </div>
    );
  }

  const counts = {
    confirmed: Object.values(statuses).filter(s => s === 'confirmed').length,
    partial: Object.values(statuses).filter(s => s === 'partial').length,
    absent: Object.values(statuses).filter(s => s === 'absent').length,
    pending: Object.values(statuses).filter(s => s === 'to_be_confirmed').length,
  };

  const byParagraph = sectionB.reduce<Record<string, P10StrengthRegisterEntry[]>>((acc, so) => {
    const p = so.paragraph ?? 'Other';
    if (!acc[p]) acc[p] = [];
    acc[p].push(so);
    return acc;
  }, {});

  const top5Ids = new Set((top5 ?? []).map(t => t.soId));

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className={`${card} flex flex-wrap items-center gap-6 px-5 py-3`}>
        <div>
          <p className={eyebrow}>Strength opportunities</p>
          <p className="mt-0.5 text-[22px] font-bold text-t1">{sectionB.length}</p>
        </div>
        <div className="h-8 w-px bg-line" />
        <div>
          <p className={eyebrow}>Confirmed</p>
          <p className={`mt-0.5 text-[22px] font-bold ${counts.confirmed > 0 ? 'text-[#166534]' : 'text-t1'}`}>{counts.confirmed}</p>
        </div>
        <div>
          <p className={eyebrow}>Partial</p>
          <p className={`mt-0.5 text-[22px] font-bold ${counts.partial > 0 ? 'text-[#92400E]' : 'text-t1'}`}>{counts.partial}</p>
        </div>
        <div>
          <p className={eyebrow}>Absent</p>
          <p className={`mt-0.5 text-[22px] font-bold ${counts.absent > 0 ? 'text-[#991B1B]' : 'text-t1'}`}>{counts.absent}</p>
        </div>
        <div>
          <p className={eyebrow}>To confirm</p>
          <p className="mt-0.5 text-[22px] font-bold text-t1">{counts.pending}</p>
        </div>
      </div>

      {/* Critical gap advisory */}
      {criticalGapAdvisory && (
        <div className="flex gap-3 rounded-[10px] border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#DC2626]" />
          <p className="text-[12.5px] leading-snug text-[#7F1D1D]">{criticalGapAdvisory}</p>
        </div>
      )}

      {/* Top 5 highlight */}
      {top5 && top5.length > 0 && (
        <div className={card}>
          <div className="border-b border-line px-4 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-wide text-t5">Top 5 by rating impact</p>
          </div>
          <div className="divide-y divide-line/60">
            {top5.map(t => (
              <div key={t.soId} className="flex items-center gap-3 px-4 py-2">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-navy/10 font-mono text-[10px] font-bold text-navy">
                  {t.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-[10px] font-bold text-t3">{t.soId}</span>
                  <span className="ml-2 text-[10px] text-t5">{t.paragraph}</span>
                  <p className="mt-0.5 text-[11.5px] text-t2">{t.impact}</p>
                </div>
                <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold ${STATUS_CONFIG[statuses[t.soId] ?? 'to_be_confirmed'].bg} ${STATUS_CONFIG[statuses[t.soId] ?? 'to_be_confirmed'].color}`}>
                  {STATUS_CONFIG[statuses[t.soId] ?? 'to_be_confirmed'].icon}
                  {STATUS_CONFIG[statuses[t.soId] ?? 'to_be_confirmed'].label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SO cards grouped by paragraph */}
      {Object.entries(byParagraph).map(([para, sos]) => (
        <div key={para} className="space-y-2">
          <p className="px-1 font-mono text-[10px] font-bold uppercase tracking-wider text-t4">{para}</p>
          {sos.map(so => (
            <SOCard
              key={so.soId}
              so={so}
              rank={top5?.find(t => t.soId === so.soId)?.rank}
              status={statuses[so.soId] ?? 'to_be_confirmed'}
              onStatusChange={handleStatusChange}
              saving={savingId === so.soId}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
