ALTER TABLE "audiobook_render_jobs"
  ADD COLUMN "idempotency_key" VARCHAR(120),
  ADD COLUMN "request" JSONB;

-- Existing jobs, if any, receive a deterministic unique migration placeholder.
UPDATE "audiobook_render_jobs"
SET "idempotency_key" = 'legacy-' || "id",
    "request" = '{}'::jsonb
WHERE "idempotency_key" IS NULL OR "request" IS NULL;

ALTER TABLE "audiobook_render_jobs"
  ALTER COLUMN "idempotency_key" SET NOT NULL,
  ALTER COLUMN "request" SET NOT NULL;

CREATE UNIQUE INDEX "audiobook_render_jobs_user_idempotency_key"
  ON "audiobook_render_jobs"("user_id", "idempotency_key");
