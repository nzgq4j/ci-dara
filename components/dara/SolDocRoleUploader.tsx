'use client';

// Workspace solicitation-document uploader. Add files (drag/drop or browse), optionally set a
// document type per file (default "Auto-detect" — the server content-classifier assigns it after
// upload), then Upload. Every file is sent in its own server-action request, all in parallel
// (Promise.all), each carrying its role only if one was manually chosen. One request per file keeps
// each under Vercel's ~4.5 MB body cap; running them in parallel means they upload simultaneously.
// No bytes leave the browser until Upload. Roles are confirmed/overridden afterward in the doc list.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Loader2 } from 'lucide-react';
import FileDropzone from '@/components/dara/FileDropzone';
import RoleStagingList, { type StagedDoc } from '@/components/dara/RoleStagingList';

export default function SolDocRoleUploader({
  solId,
  label,
  sub,
  uploadAction
}: {
  solId: string;
  label?: string;
  sub?: string;
  uploadAction: (fd: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [items, setItems] = useState<StagedDoc[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // FileDropzone is rendered with an empty file list, so each onChange hands us only the newly
  // picked files; we merge them into the staging list (Auto-detect), de-duping by name+size.
  const addFiles = (added: File[]) => {
    setError(null);
    setItems((prev) => {
      const seen = new Set(prev.map((it) => `${it.file.name}:${it.file.size}`));
      const fresh = added
        .filter((f) => !seen.has(`${f.name}:${f.size}`))
        .map((f) => ({ file: f, role: '' }));
      return [...prev, ...fresh];
    });
  };

  const upload = () => {
    if (items.length === 0 || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        // All files upload simultaneously — one request each, run in parallel.
        await Promise.all(
          items.map(({ file, role }) => {
            const fd = new FormData();
            fd.set('solId', solId);
            fd.set('docType', 'rfp');
            if (role) fd.set('role', role); // omitted → server auto-classifies by content
            fd.set('file', file);
            return uploadAction(fd);
          })
        );
        setItems([]);
        router.refresh();
      } catch {
        setError('Some files failed to upload — check the file type (PDF or Word) and try again.');
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-3">
      <FileDropzone files={[]} onChange={addFiles} label={label} sub={sub} accept=".pdf,.docx" compact />
      <RoleStagingList items={items} onChange={setItems} disabled={pending} />
      {error && (
        <p className="rounded-md border border-[#991B1B]/25 bg-[#FEE2E2] px-3 py-2 text-[12px] text-[#991B1B]">
          {error}
        </p>
      )}
      {items.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={upload}
            disabled={pending}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {pending ? 'Uploading…' : `Upload ${items.length} file${items.length > 1 ? 's' : ''}`}
          </button>
          <span className="text-[12px] text-t5">Types left on “Auto-detect” are classified by AI, then shown for you to confirm.</span>
        </div>
      )}
    </div>
  );
}
