'use client';

// Inline-editable solicitation title. Direct AI solicitations get an auto-derived name at
// upload (from the sol number or first filename), so the title needs to be renamable. Click
// the pencil to edit; Enter or Save commits via the server action, Esc/Cancel reverts.

import { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Check, X, Loader2 } from 'lucide-react';

export default function EditableSolTitle({
  solId,
  title,
  renameAction
}: {
  solId: string;
  title: string;
  renameAction: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = () => {
    const next = value.trim();
    if (!next) {
      setError('Name cannot be empty.');
      return;
    }
    if (next === title) {
      setEditing(false);
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set('solId', solId);
    fd.set('title', next);
    startTransition(async () => {
      const res = await renameAction(fd);
      if (res?.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(res?.error ?? 'Rename failed.');
      }
    });
  };

  const cancel = () => {
    setValue(title);
    setError(null);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="group flex items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-t1">{title}</h1>
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Rename"
          aria-label="Rename solicitation"
          className="rounded p-1 text-t5 opacity-0 transition-opacity hover:text-navy group-hover:opacity-100 focus:opacity-100"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={value}
          maxLength={500}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') cancel();
          }}
          className="w-full max-w-xl rounded-lg border border-line bg-bg px-3 py-1.5 text-2xl font-bold tracking-tight text-t1 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          title="Save"
          className="rounded-md bg-navy p-2 text-white transition-colors hover:bg-navy/90 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          title="Cancel"
          className="rounded-md border border-line p-2 text-t4 transition-colors hover:text-t1 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {error && <p className="text-[12px] text-[#991B1B]">{error}</p>}
    </div>
  );
}
