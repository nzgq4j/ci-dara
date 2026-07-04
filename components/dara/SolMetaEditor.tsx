'use client';

// Editable solicitation metadata (reference number, agency, NAICS, due date) shown under the
// workspace title. Displays a compact summary line with an edit pencil; editing reveals inline
// fields saved via updateSolMetaAction. Due date + NAICS feed the dashboard countdown/KPIs.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Check, X, Loader2 } from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDay(iso: string): string {
  // iso is 'YYYY-MM-DD'
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export default function SolMetaEditor({
  solId,
  solNumber,
  agency,
  naics,
  dueDate,
  updateAction
}: {
  solId: string;
  solNumber: string;
  agency: string;
  naics: string;
  dueDate: string; // 'YYYY-MM-DD' or ''
  updateAction: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [sn, setSn] = useState(solNumber);
  const [ag, setAg] = useState(agency);
  const [nc, setNc] = useState(naics);
  const [due, setDue] = useState(dueDate);
  const [pending, startTransition] = useTransition();

  const save = () => {
    const fd = new FormData();
    fd.set('solId', solId);
    fd.set('solNumber', sn);
    fd.set('agency', ag);
    fd.set('naics', nc);
    fd.set('dueDate', due);
    startTransition(async () => {
      const res = await updateAction(fd);
      if (res?.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  };
  const cancel = () => {
    setSn(solNumber);
    setAg(agency);
    setNc(naics);
    setDue(dueDate);
    setEditing(false);
  };

  if (!editing) {
    const parts = [
      solNumber || 'No reference number',
      agency,
      naics ? `NAICS ${naics}` : '',
      dueDate ? `Due ${fmtDay(dueDate)}` : ''
    ].filter(Boolean);
    return (
      <div className="group mb-1 flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-t5">{parts.join(' · ')}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Edit details"
          aria-label="Edit solicitation details"
          className="rounded p-0.5 text-t5 opacity-0 transition-opacity hover:text-navy group-hover:opacity-100 focus:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const field = 'rounded border border-line bg-bg px-2 py-1 text-[12px] text-t2 outline-none focus:border-gold focus:ring-1 focus:ring-gold';
  return (
    <div className="mb-2 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-0.5">
        <span className="font-mono text-[9px] uppercase tracking-wide text-t5">Reference</span>
        <input value={sn} onChange={(e) => setSn(e.target.value)} placeholder="e.g. FA8650-26-S-1841" className={`${field} w-44`} />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="font-mono text-[9px] uppercase tracking-wide text-t5">Agency</span>
        <input value={ag} onChange={(e) => setAg(e.target.value)} placeholder="Agency" className={`${field} w-44`} />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="font-mono text-[9px] uppercase tracking-wide text-t5">NAICS</span>
        <input value={nc} onChange={(e) => setNc(e.target.value)} placeholder="541715" className={`${field} w-24`} />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="font-mono text-[9px] uppercase tracking-wide text-t5">Due date</span>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={`${field} w-36`} />
      </label>
      <button type="button" onClick={save} disabled={pending} title="Save" className="rounded-md bg-navy p-1.5 text-white transition-colors hover:bg-navy/90 disabled:opacity-50">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      <button type="button" onClick={cancel} disabled={pending} title="Cancel" className="rounded-md border border-line p-1.5 text-t4 transition-colors hover:text-t1 disabled:opacity-50">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
