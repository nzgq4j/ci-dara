import { createClient } from '@supabase/supabase-js';
import { encryptField } from '@/utils/dara/crypto';

// Document storage + text extraction for evaluation inputs.
// Files are stored in a private Supabase Storage bucket; text is extracted
// server-side (PDF via pdf-parse, DOCX via mammoth, plain text as-is).

export const DOCS_BUCKET = 'dara-documents';

// Server-side upload constraints (defense-in-depth; the UI `accept` attribute is
// not trustworthy). Content type is derived from the extension here, not taken
// from the client-supplied File.type.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown'
};

function fileExt(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

/** Validate an upload by extension, size, and magic bytes. Throws on violation. */
function assertValidUpload(buffer: Buffer, ext: string): void {
  if (!ALLOWED_TYPES[ext]) {
    throw new Error(`Unsupported file type: .${ext || '?'} (allowed: PDF, DOCX, TXT, MD)`);
  }
  if (buffer.length === 0) throw new Error('Empty file.');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File too large (${Math.round(buffer.length / 1048576)} MB; max 20 MB).`
    );
  }
  // Magic-byte sanity for binary formats (guards against type spoofing).
  if (ext === 'pdf' && buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('File does not appear to be a valid PDF.');
  }
  if (
    ext === 'docx' &&
    !(buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04)
  ) {
    // DOCX is a ZIP container and must start with "PK\x03\x04".
    throw new Error('File does not appear to be a valid DOCX.');
  }
}

function storage() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const lower = filename.toLowerCase();
  try {
    if (lower.endsWith('.pdf')) {
      // unpdf bundles a serverless-friendly (worker-free) pdfjs build, which
      // avoids the worker / asset-tracing failures pdf-parse hits on Vercel.
      const { extractText: pdfExtractText } = await import('unpdf');
      // mergePages:false preserves per-line \n structure; mergePages:true flattens every line
      // break to a space, destroying section headings and paragraph boundaries (which defeats
      // deriveCitation and pushes the shred toward sentence-level fragmentation). Join pages with
      // a blank line. Soft line-wrap newlines are harmless — verifySpan's normalize() collapses
      // whitespace runs, so a model's un-wrapped quote still matches the stored (wrapped) text.
      const { text: pages } = await pdfExtractText(new Uint8Array(buffer), {
        mergePages: false
      });
      return Array.isArray(pages) ? pages.join('\n\n') : String(pages ?? '');
    }
    if (lower.endsWith('.docx')) {
      const mammoth: any = await import('mammoth');
      const r = await mammoth.extractRawText({ buffer });
      return String(r?.value ?? '');
    }
    if (lower.endsWith('.txt') || lower.endsWith('.md')) {
      return buffer.toString('utf8');
    }
  } catch (e) {
    // Surface the reason in the function logs; caller marks status 'failed'.
    console.error(`[extractText] failed for ${filename}:`, e);
    return '';
  }
  return '';
}

export interface StoredDoc {
  originalFilename: string;
  storedFilename: string;
  fileSize: number;
  extractedText: string;
  extractionStatus: 'complete' | 'failed';
}

/**
 * Upload a file to storage and extract its text. `prefix` namespaces the object
 * path (e.g. "sol" or "response"). Throws on storage upload failure.
 */
export async function uploadAndExtract(
  file: File,
  companyId: bigint,
  prefix: string,
  stamp: number
): Promise<StoredDoc> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = fileExt(file.name);
  assertValidUpload(buffer, ext);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storedFilename = `${prefix}/${companyId.toString()}/${stamp}-${safeName}`;

  const sb = storage();
  const { error } = await sb.storage
    .from(DOCS_BUCKET)
    .upload(storedFilename, buffer, {
      contentType: ALLOWED_TYPES[ext], // server-derived, not client-supplied
      upsert: false
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const text = await extractText(file.name, buffer);
  // Status reflects whether text was extracted (from plaintext); the stored value
  // is encrypted at rest (DARA-009). The evaluator decrypts it via decryptField.
  const extractionStatus = text.trim() !== '' ? 'complete' : 'failed';
  return {
    originalFilename: file.name,
    storedFilename,
    fileSize: buffer.length,
    extractedText: encryptField(text),
    extractionStatus
  };
}

/** Remove stored objects by path. Best-effort: ignores errors. */
export async function removeStored(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await storage().storage.from(DOCS_BUCKET).remove(paths);
  } catch {
    // ignore — DB row removal is the source of truth for the UI
  }
}
