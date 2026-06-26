import { createClient } from '@supabase/supabase-js';

// Document storage + text extraction for evaluation inputs.
// Files are stored in a private Supabase Storage bucket; text is extracted
// server-side (PDF via pdf-parse, DOCX via mammoth, plain text as-is).

export const DOCS_BUCKET = 'dara-documents';

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
      const { text } = await pdfExtractText(new Uint8Array(buffer), {
        mergePages: true
      });
      return text || '';
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
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storedFilename = `${prefix}/${companyId.toString()}/${stamp}-${safeName}`;

  const sb = storage();
  const { error } = await sb.storage
    .from(DOCS_BUCKET)
    .upload(storedFilename, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const text = await extractText(file.name, buffer);
  return {
    originalFilename: file.name,
    storedFilename,
    fileSize: buffer.length,
    extractedText: text,
    extractionStatus: text.trim() !== '' ? 'complete' : 'failed'
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
