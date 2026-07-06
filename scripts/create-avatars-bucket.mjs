// Create (or repair) the public `dara-avatars` Storage bucket used by the
// self-service profile avatar upload (utils/dara/avatar.ts).
//
// Avatars are non-sensitive and shown on every page, so the bucket is PUBLIC
// (public read, no signed URLs). Uploads go through the service-role client, which
// bypasses Storage RLS, so no additional storage policies are required.
//
// Run against prod (the only DB; .env.local targets it):
//   node --env-file=.env.local scripts/create-avatars-bucket.mjs
//
// Idempotent: if the bucket already exists it is updated to the intended settings.

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const BUCKET = 'dara-avatars';
const settings = {
  public: true,
  fileSizeLimit: '5MB',
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp']
};

const sb = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const { error: createErr } = await sb.storage.createBucket(BUCKET, settings);
if (createErr) {
  if (/already exists/i.test(createErr.message)) {
    const { error: updateErr } = await sb.storage.updateBucket(BUCKET, settings);
    if (updateErr) {
      console.error(`Bucket exists but update failed: ${updateErr.message}`);
      process.exit(1);
    }
    console.log(`Bucket "${BUCKET}" already existed — settings verified/updated.`);
  } else {
    console.error(`Failed to create bucket: ${createErr.message}`);
    process.exit(1);
  }
} else {
  console.log(`Created public bucket "${BUCKET}".`);
}
