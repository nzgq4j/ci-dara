'use client';

// Reusable drag-and-drop + browse file picker (controlled). Collects File objects into the
// parent's state and renders the selected list with per-file remove. Used by the Upload &
// Instant Review screen and the workspace document uploaders so the whole app shares one
// upload affordance. Colors use the app's semantic tokens (D5).

import { useRef, useState } from 'react';
import { UploadCloud, FileText, CheckCircle2, X } from 'lucide-react';

const ACCEPT = '.pdf,.docx,.txt,.md';

export default function FileDropzone({
  files,
  onChange,
  label = 'Drop files here',
  sub = 'PDF, Word, or text · max 20 MB',
  accept = ACCEPT,
  compact = false
}: {
  files: File[];
  onChange: (next: File[]) => void;
  label?: string;
  sub?: string;
  accept?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const add = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const seen = new Set(files.map((f) => `${f.name}:${f.size}`));
    const next = [...files, ...Array.from(list).filter((f) => !seen.has(`${f.name}:${f.size}`))];
    onChange(next);
  };
  const remove = (idx: number) => onChange(files.filter((_, i) => i !== idx));

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          add(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-[6px] border-2 border-dashed text-center transition-colors ${
          compact ? 'px-4 py-6' : 'px-6 py-10'
        } ${dragOver ? 'border-[#3b6ef0] bg-[#3b6ef0]/5' : 'border-line bg-bg'}`}
      >
        <UploadCloud className={compact ? 'h-5 w-5 text-t5' : 'h-6 w-6 text-t5'} />
        <p className={`mt-2 font-semibold text-t1 ${compact ? 'text-[13px]' : 'text-[15px]'}`}>{label}</p>
        <p className="mt-0.5 text-[12px] text-t4">{sub}</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-3 inline-flex items-center rounded-md border border-[#3b6ef0]/50 px-3 py-1.5 text-[12px] font-medium text-[#8fb0f5] transition-colors hover:bg-[#3b6ef0]/10"
        >
          Browse files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = ''; // allow re-picking the same file after a remove
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#7de0a0]" />
              <FileText className="h-4 w-4 shrink-0 text-t5" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-t2">{f.name}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="shrink-0 rounded p-0.5 text-t5 transition-colors hover:text-[#e88]"
                aria-label={`Remove ${f.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
