CREATE TABLE "quant_paper_strategies" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "experiment_id" TEXT NOT NULL,
  "allocation_pct" NUMERIC(5, 2) NOT NULL DEFAULT 10.00,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_strategies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_paper_strategies_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_strategies_experiment_id_fkey" FOREIGN KEY ("experiment_id")
    REFERENCES "quant_experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_strategies_allocation_check" CHECK ("allocation_pct" >= 1 AND "allocation_pct" <= 100),
  CONSTRAINT "quant_paper_strategies_user_experiment_key" UNIQUE ("user_id", "experiment_id")
);

CREATE INDEX "quant_paper_strategies_user_enabled_idx"
  ON "quant_paper_strategies"("user_id", "enabled", "created_at" DESC);
