-- Legal acceptance (Terms of Service + Supplemental Policy Addendum) on dara_users.
-- Current-state columns only; the immutable signing event is also recorded in
-- dara_audit_log (legal.accept, with version + signed name + IP). Additive + nullable →
-- safe online ALTER, no backfill. Existing per-tenant RLS + grants (DARA-004) cover the
-- new columns automatically — no paired security SQL needed.
-- AlterTable
ALTER TABLE "dara_users" ADD COLUMN     "tos_accepted_at" TIMESTAMP(3),
ADD COLUMN     "tos_accepted_version" VARCHAR(20),
ADD COLUMN     "tos_signed_name" VARCHAR(255);
