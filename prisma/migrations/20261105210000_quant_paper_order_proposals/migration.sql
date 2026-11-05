CREATE TABLE "quant_paper_order_proposals" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "signal_id" TEXT NOT NULL,
  "market_data_import_id" TEXT NOT NULL,
  "symbol" VARCHAR(15) NOT NULL,
  "side" VARCHAR(4) NOT NULL,
  "quantity" NUMERIC(24,8) NOT NULL,
  "reference_price" NUMERIC(24,8) NOT NULL,
  "notional" NUMERIC(24,8) NOT NULL,
  "client_order_id" VARCHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "order_id" TEXT,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMPTZ(6),
  CONSTRAINT "quant_paper_order_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_paper_order_proposals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_order_proposals_signal_id_fkey"
    FOREIGN KEY ("signal_id") REFERENCES "quant_strategy_signals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_order_proposals_market_data_import_id_fkey"
    FOREIGN KEY ("market_data_import_id") REFERENCES "quant_market_data_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_order_proposals_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "quant_paper_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_order_proposals_side_check"
    CHECK ("side" IN ('buy', 'sell')),
  CONSTRAINT "quant_paper_order_proposals_status_check"
    CHECK ("status" IN ('pending', 'confirmed', 'rejected', 'expired')),
  CONSTRAINT "quant_paper_order_proposals_values_check"
    CHECK ("quantity" > 0 AND "reference_price" > 0 AND "notional" > 0),
  CONSTRAINT "quant_paper_order_proposals_idempotency_key"
    UNIQUE ("user_id", "client_order_id")
);

CREATE INDEX "quant_paper_order_proposals_user_status_created_idx"
  ON "quant_paper_order_proposals"("user_id", "status", "created_at" DESC);
CREATE INDEX "quant_paper_order_proposals_status_expiry_idx"
  ON "quant_paper_order_proposals"("status", "expires_at");

-- Proposals are visible only through authenticated API endpoints.
DO $quant_proposal_isolation$
DECLARE
  browser_role TEXT;
BEGIN
  ALTER TABLE public.quant_paper_order_proposals ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.quant_paper_order_proposals FROM PUBLIC;

  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'quant_paper_order_proposals', browser_role);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.quant_paper_order_proposals TO service_role;
  END IF;
END;
$quant_proposal_isolation$;
