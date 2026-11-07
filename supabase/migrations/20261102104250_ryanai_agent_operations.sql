CREATE TABLE "agent_runs" ("id" TEXT NOT NULL,"user_id" TEXT NOT NULL,"objective" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'queued',"result" JSONB,"error" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"completed_at" TIMESTAMP(3),CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id"));
CREATE TABLE "agent_handoffs" ("id" TEXT NOT NULL,"run_id" TEXT NOT NULL,"from_agent" TEXT NOT NULL,"to_agent" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'pending',"input" TEXT NOT NULL,"output" TEXT,"error" TEXT,"started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"completed_at" TIMESTAMP(3),CONSTRAINT "agent_handoffs_pkey" PRIMARY KEY ("id"));
CREATE TABLE "agent_brain_health" ("id" TEXT NOT NULL,"brain" TEXT NOT NULL,"model" TEXT NOT NULL,"status" TEXT NOT NULL,"latency_ms" INTEGER,"last_success_at" TIMESTAMP(3),"last_error" TEXT,"checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "agent_brain_health_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "agent_brain_health_brain_key" ON "agent_brain_health"("brain");
CREATE INDEX "agent_runs_user_id_created_at_idx" ON "agent_runs"("user_id","created_at");
CREATE INDEX "agent_runs_status_created_at_idx" ON "agent_runs"("status","created_at");
CREATE INDEX "agent_handoffs_run_id_started_at_idx" ON "agent_handoffs"("run_id","started_at");
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_handoffs" ADD CONSTRAINT "agent_handoffs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
