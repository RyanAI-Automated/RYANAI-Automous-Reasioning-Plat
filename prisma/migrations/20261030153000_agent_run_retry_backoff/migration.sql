ALTER TABLE "agent_runs"
  ADD COLUMN "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "agent_runs_status_next_attempt_at_idx"
  ON "agent_runs"("status", "next_attempt_at");
