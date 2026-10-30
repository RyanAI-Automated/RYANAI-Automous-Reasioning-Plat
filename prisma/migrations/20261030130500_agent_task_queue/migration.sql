ALTER TABLE "agent_runs"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "worker_id" TEXT,
  ADD COLUMN "locked_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "agent_runs_status_locked_at_idx" ON "agent_runs"("status", "locked_at");
