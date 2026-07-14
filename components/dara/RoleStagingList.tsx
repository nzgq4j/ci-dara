'use client';

// Controlled per-file staging list used by every solicitation-document uploader. Each staged
// file is a row: [ filename ] [ role dropdown ] [ remove ]. The role dropdown has no default — it
// shows "Select document type…" until the user picks one. Purely client-side state; no bytes are
// sent until the parent's Upload action fires. Kept presentational so the create wizard and the
// workspace share one identical UX (they differ only in how/when the actual upload runs).

import { FileText, X } from 'lucide-react';
import { DOCUMENT_ROLES } from '@/utils/dara/document-roles';

// role === '' → "Auto-detect": the server content-classifier assigns the role after upload. A
// non-empty role is an explicit manual choice that skips the classifier for that file.
export type StagedDoc = { file: File; role: string };

export default function RoleStagingList({
  items,
  onChange,
  disabled = false
}: {
  items: StagedDoc[];
  onChange: (next: StagedDoc[]) => void;
  disabled?: boolean;
}) {
  if (items.length === 0) return null;

  const setRole = (idx: number, role: string) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, role } : it)));
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  return (
    <ul className="mt-3 space-y-2">
      {items.map((it, i) => (
        <li
          key={`${it.file.name}-${it.file.size}-${i}`}
          className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2"
        >
          <FileText className="h-4 w-4 shrink-0 text-t5" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-t2" title={it.file.name}>
            {it.file.name}
          </span>
          <select
            value={it.role}
            disabled={disabled}
            onChange={(e) => setRole(i, e.target.value)}
            aria-label={`Document type for ${it.file.name}`}
            className="shrink-0 rounded-md border border-line bg-surf px-2 py-1.5 text-[12px] text-t1 transition-colors focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold disabled:opacity-50"
          >
            <option value="">Auto-detect (AI classifies)</option>
            {DOCUMENT_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={disabled}
            className="shrink-0 rounded p-0.5 text-t5 transition-colors hover:text-[#dc2626] disabled:opacity-50"
            aria-label={`Remove ${it.file.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
