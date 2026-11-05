CREATE TABLE "quant_paper_risk_policies" (
  "user_id" TEXT NOT NULL,
  "max_order_notional" NUMERIC(18, 2) NOT NULL DEFAULT 10000,
  "max_position_notional" NUMERIC(18, 2) NOT NULL DEFAULT 25000,
  "max_gross_exposure" NUMERIC(18, 2) NOT NULL DEFAULT 75000,
  "trading_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_risk_policies_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "quant_paper_risk_policies_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_risk_policies_order_cap" CHECK ("max_order_notional" >= 100 AND "max_order_notional" <= 10000),
  CONSTRAINT "quant_paper_risk_policies_position_cap" CHECK ("max_position_notional" >= 100 AND "max_position_notional" <= 50000),
  CONSTRAINT "quant_paper_risk_policies_gross_cap" CHECK ("max_gross_exposure" >= 100 AND "max_gross_exposure" <= 100000),
  CONSTRAINT "quant_paper_risk_policies_order_le_position" CHECK ("max_order_notional" <= "max_position_notional"),
  CONSTRAINT "quant_paper_risk_policies_position_le_gross" CHECK ("max_position_notional" <= "max_gross_exposure")
);
