CREATE TABLE "pa_identity_nonces" (
  "id" UUID NOT NULL,
  "nonce" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pa_identity_nonces_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pa_identity_nonces_nonce_key" ON "pa_identity_nonces"("nonce");
CREATE INDEX "pa_identity_nonces_expires_at_idx" ON "pa_identity_nonces"("expires_at");

CREATE TABLE "pa_delegations" (
  "id" UUID NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "requested_capabilities" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "trace_id" TEXT NOT NULL,
  "agent_run_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "pa_delegations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pa_delegations_agent_run_id_key" ON "pa_delegations"("agent_run_id");
CREATE INDEX "pa_delegations_owner_user_id_created_at_idx" ON "pa_delegations"("owner_user_id","created_at");
CREATE INDEX "pa_delegations_status_created_at_idx" ON "pa_delegations"("status","created_at");
ALTER TABLE "pa_delegations" ADD CONSTRAINT "pa_delegations_agent_run_id_fkey"
  FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pa_execution_receipts" (
  "id" UUID NOT NULL,
  "delegation_id" UUID NOT NULL,
  "agent_run_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "trace_id" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "result" JSONB,
  "error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pa_execution_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pa_execution_receipts_delegation_id_key" ON "pa_execution_receipts"("delegation_id");
CREATE INDEX "pa_execution_receipts_agent_run_id_created_at_idx" ON "pa_execution_receipts"("agent_run_id","created_at");
CREATE INDEX "pa_execution_receipts_trace_id_created_at_idx" ON "pa_execution_receipts"("trace_id","created_at");
ALTER TABLE "pa_execution_receipts" ADD CONSTRAINT "pa_execution_receipts_delegation_id_fkey"
  FOREIGN KEY ("delegation_id") REFERENCES "pa_delegations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
