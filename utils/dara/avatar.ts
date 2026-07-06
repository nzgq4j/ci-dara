import { createClient } from '@supabase/supabase-js';

// Avatar image storage. Unlike documents (private, CUI, encrypted), avatars are
// non-sensitive and shown on every page, so they live in a PUBLIC bucket and we
// store the resulting public URL on dara_users.avatar_url. Uploads go through the
// service-role client (server-side only); public read needs no signed URLs.

export const AVATARS_BUCKET = 'dara-avatars';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
// Extension → (content type, magic-byte check). Client File.type is not trusted.
const IMAGE_TYPES: Record<string, { mime: string; sniff: (b: Buffer) => boolean }> = {
  png: { mime: 'image/png', sniff: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  jpg: { mime: 'image/jpeg', sniff: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: 'image/jpeg', sniff: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: {
    mime: 'image/webp',
    sniff: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP'
  }
};

function fileExt(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function storage() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Upload/replace a user's avatar. Returns a public URL (cache-busted). Throws on
 * an invalid image or a storage failure. The object path is keyed by userId so a
 * re-upload upserts in place (no orphaned files); contentType is server-derived.
 */
export async function uploadAvatar(
  userId: string,
  file: File,
  stamp: number
): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = fileExt(file.name);
  const spec = IMAGE_TYPES[ext];
  if (!spec) {
    throw new Error('Unsupported image type (use PNG, JPG, or WebP).');
  }
  if (buffer.length === 0) throw new Error('Empty file.');
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw new Error(`Image too large (${Math.round(buffer.length / 1048576)} MB; max 5 MB).`);
  }
  if (!spec.sniff(buffer)) {
    throw new Error(`File does not appear to be a valid ${ext.toUpperCase()} image.`);
  }

  const path = `${userId}/avatar`;
  const sb = storage();
  const { error } = await sb.storage.from(AVATARS_BUCKET).upload(path, buffer, {
    contentType: spec.mime, // server-derived, not client-supplied
    upsert: true
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = sb.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  // Cache-bust so the overwritten object refreshes in the browser/CDN.
  return `${data.publicUrl}?v=${stamp}`;
}

/** Best-effort removal of a user's avatar object. */
export async function removeAvatar(userId: string): Promise<void> {
  try {
    await storage().storage.from(AVATARS_BUCKET).remove([`${userId}/avatar`]);
  } catch {
    // ignore — the DB avatar_url reset is what drives the UI
  }
}
