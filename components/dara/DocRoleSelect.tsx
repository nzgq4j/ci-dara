'use client';

// Doc-list control for a solicitation document's role. Shows the current role (AI-classified or
// manual) as a dropdown the user can change, plus a "Suggested" chip + Confirm button while the
// role is an unconfirmed AI guess. Changing or confirming calls the setDocumentRole server action
// (which also re-gates the pipeline) and refreshes. Used only for solicitation (rfp) documents.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Wand2, Check } from 'lucide-react';
import { DOCUMENT_ROLES } from '@/utils/dara/document-roles';

export default function DocRoleSelect({
  docId,
  solId,
  role,
  suggested,
  action
}: {
  docId: string;
  solId: string;
  role: string | null;
  suggested: boolean;
  action: (fd: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const submit = (value: string) => {
    if (!value) return;
    const fd = new FormData();
    fd.set('docId', docId);
    fd.set('solId', solId);
    fd.set('role', value);
    start(async () => {
      await action(fd);
      router.refresh();
    });
  };

  const showSuggested = suggested && !!role;

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {showSuggested && (
        <span
          className="inline-flex items-center gap-1 rounded bg-gold/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-[#8a6d1f]"
          title="Classified by AI — confirm or change"
        >
          <Wand2 className="h-2.5 w-2.5" /> Suggested
        </span>
      )}
      <select
        value={role ?? ''}
        disabled={pending}
        onChange={(e) => submit(e.target.value)}
        aria-label="Document type"
        className="max-w-[190px] shrink-0 rounded-md border border-line bg-surf px-2 py-1 text-[11px] text-t1 transition-colors focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold disabled:opacity-50"
      >
        <option value="" disabled>
          Unclassified…
        </option>
        {DOCUMENT_ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      {showSuggested && !pending && (
        <button
          type="button"
          onClick={() => role && submit(role)}
          title="Confirm this classification"
          aria-label="Confirm document type"
          className="rounded p-0.5 text-[#166534] transition-colors hover:bg-[#166534]/10"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      )}
      {pending && <Loader2 className="h-3 w-3 animate-spin text-t5" />}
    </span>
  );
}
