-- Free-text team notes for the compliance matrix (design's "Notes" column).
-- Column-only add on an already-granted table — apply with `migrate deploy`; no new RLS.

ALTER TABLE "dara_requirements" ADD COLUMN "notes" TEXT;
