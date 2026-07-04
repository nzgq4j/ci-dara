'use client';

// Workspace document uploader — the same drag-drop/browse affordance as the Upload & Instant
// Review screen, wired to the existing uploadSolDoc server action. Collects one or more files
// then uploads them (one call per file, since uploadSolDoc takes a single file), showing
// progress, and refreshes the workspace so the new docs + extraction status appear.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Loader2 } from 'lucide-react';
import FileDropzone from '@/components/dara/FileDropzone';

export default function DocUploader({
  solId,
  docType,
  amendmentId,
  label,
  sub,
  uploadAction
}: {
  solId: string;
  docType: 'rfp' | 'proposal' | 'amendment';
  amendmentId?: string;
  label?: string;
  sub?: string;
  uploadAction: (fd: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const upload = () => {
    if (files.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        for (const f of files) {
          const fd = new FormData();
          fd.set('solId', solId);
          fd.set('docType', docType);
          if (amendmentId) fd.set('amendmentId', amendmentId);
          fd.set('file', f);
          await uploadAction(fd);
        }
        setFiles([]);
        router.refresh();
      } catch {
        setError('Upload failed — check the file type (PDF, Word, or text) and try again.');
      }
    });
  };

  return (
    <div className="space-y-3">
      <FileDropzone files={files} onChange={setFiles} label={label} sub={sub} compact />
      {error && (
        <p className="rounded-md border border-[#5a1f1f]/60 bg-[#5a1f1f]/10 px-3 py-2 text-[12px] text-[#e88]">
          {error}
        </p>
      )}
      {files.length > 0 && (
        <button
          type="button"
          onClick={upload}
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {pending ? 'Uploading…' : `Upload ${files.length} file${files.length > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  );
}
