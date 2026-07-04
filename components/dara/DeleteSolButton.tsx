'use client';

// Confirm-guarded delete for a solicitation, used from the central Solicitations list. Delete
// is destructive (removes all requirements/reviews/documents), so it always confirms first.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Loader2 } from 'lucide-react';

export default function DeleteSolButton({
  solId,
  title,
  action
}: {
  solId: string;
  title: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const onDelete = () => {
    if (
      !window.confirm(
        `Delete "${title}"?\n\nThis permanently removes its requirements, reviews, documents, and evaluations. This cannot be undone.`
      )
    )
      return;
    const fd = new FormData();
    fd.set('solId', solId);
    start(async () => {
      await action(fd);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={pending}
      title="Delete solicitation"
      aria-label="Delete solicitation"
      className="inline-flex items-center justify-center rounded-md border border-[#991B1B]/30 p-1.5 text-[#991B1B] transition-colors hover:bg-[#FEE2E2] disabled:opacity-50"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}
