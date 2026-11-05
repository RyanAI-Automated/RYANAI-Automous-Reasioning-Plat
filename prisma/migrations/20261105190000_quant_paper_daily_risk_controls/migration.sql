ALTER TABLE "quant_paper_risk_policies"
  ADD COLUMN "max_daily_loss" NUMERIC(18,2) NOT NULL DEFAULT 5000,
  ADD COLUMN "max_drawdown_pct" NUMERIC(6,2) NOT NULL DEFAULT 10,
  ADD COLUMN "emergency_stop" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "emergency_stop_reason" TEXT,
  ADD COLUMN "emergency_stopped_at" TIMESTAMPTZ(6);

ALTER TABLE "quant_paper_risk_policies"
  ADD CONSTRAINT "quant_paper_risk_policies_daily_loss_cap"
    CHECK ("max_daily_loss" >= 100 AND "max_daily_loss" <= 50000),
  ADD CONSTRAINT "quant_paper_risk_policies_drawdown_cap"
    CHECK ("max_drawdown_pct" >= 1 AND "max_drawdown_pct" <= 50);

CREATE TABLE "quant_paper_daily_risk_state" (
  "user_id" TEXT NOT NULL,
  "risk_date" DATE NOT NULL,
  "starting_equity" NUMERIC(24,8) NOT NULL,
  "current_equity" NUMERIC(24,8) NOT NULL,
  "daily_loss" NUMERIC(24,8) NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_daily_risk_state_pkey" PRIMARY KEY ("user_id", "risk_date"),
  CONSTRAINT "quant_paper_daily_risk_state_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_daily_risk_state_values_check"
    CHECK ("starting_equity" >= 0 AND "current_equity" >= 0 AND "daily_loss" >= 0)
);

CREATE TABLE "quant_paper_portfolio_risk_state" (
  "user_id" TEXT NOT NULL,
  "peak_equity" NUMERIC(24,8) NOT NULL,
  "current_equity" NUMERIC(24,8) NOT NULL,
  "max_drawdown_pct" NUMERIC(8,4) NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_portfolio_risk_state_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "quant_paper_portfolio_risk_state_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_portfolio_risk_state_values_check"
    CHECK ("peak_equity" >= 0 AND "current_equity" >= 0 AND "max_drawdown_pct" >= 0 AND "max_drawdown_pct" <= 100)
);

CREATE INDEX "quant_paper_daily_risk_state_date_idx"
  ON "quant_paper_daily_risk_state"("risk_date" DESC);
