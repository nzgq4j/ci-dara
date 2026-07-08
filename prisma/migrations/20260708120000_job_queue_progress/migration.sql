-- AddColumn: progress tracking fields for background jobs (shred phase label)
ALTER TABLE "dara_job_queue"
  ADD COLUMN IF NOT EXISTS "progress" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "progress_label" VARCHAR(200);
