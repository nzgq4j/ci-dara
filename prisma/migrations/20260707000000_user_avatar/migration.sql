-- Self-service profile: user avatar. Public URL of an uploaded image in the
-- dara-avatars Storage bucket; NULL renders initials as before.
-- Additive + nullable → safe online ALTER, no backfill. Existing dara_users
-- per-tenant RLS + grants (DARA-004) cover the new column automatically — no
-- paired security SQL needed.
-- AlterTable
ALTER TABLE "dara_users" ADD COLUMN     "avatar_url" VARCHAR(1024);
