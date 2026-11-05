CREATE TABLE "quant_paper_accounts" (
  "user_id" TEXT NOT NULL,
  "cash_balance" NUMERIC(24, 8) NOT NULL DEFAULT 100000,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_accounts_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "quant_paper_accounts_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_accounts_cash_nonnegative" CHECK ("cash_balance" >= 0)
);

CREATE TABLE "quant_paper_positions" (
  "user_id" TEXT NOT NULL,
  "symbol" VARCHAR(15) NOT NULL,
  "quantity" NUMERIC(24, 8) NOT NULL,
  "average_entry_price" NUMERIC(24, 8) NOT NULL,
  "last_price" NUMERIC(24, 8) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_positions_pkey" PRIMARY KEY ("user_id", "symbol"),
  CONSTRAINT "quant_paper_positions_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_positions_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "quant_paper_positions_prices_positive" CHECK ("average_entry_price" > 0 AND "last_price" > 0)
);

CREATE TABLE "quant_paper_orders" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "client_order_id" VARCHAR(64) NOT NULL,
  "symbol" VARCHAR(15) NOT NULL,
  "side" VARCHAR(4) NOT NULL,
  "quantity" NUMERIC(24, 8) NOT NULL,
  "reference_price" NUMERIC(24, 8) NOT NULL,
  "fill_price" NUMERIC(24, 8) NOT NULL,
  "fee" NUMERIC(24, 8) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'filled',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_paper_orders_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_orders_side_check" CHECK ("side" IN ('buy', 'sell')),
  CONSTRAINT "quant_paper_orders_status_check" CHECK ("status" IN ('filled')),
  CONSTRAINT "quant_paper_orders_values_check" CHECK ("quantity" > 0 AND "reference_price" > 0 AND "fill_price" > 0 AND "fee" >= 0),
  CONSTRAINT "quant_paper_orders_idempotency_key" UNIQUE ("user_id", "client_order_id")
);

CREATE INDEX "quant_paper_orders_user_created_idx"
  ON "quant_paper_orders"("user_id", "created_at" DESC);

CREATE TABLE "quant_paper_trades" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "order_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "symbol" VARCHAR(15) NOT NULL,
  "side" VARCHAR(4) NOT NULL,
  "quantity" NUMERIC(24, 8) NOT NULL,
  "price" NUMERIC(24, 8) NOT NULL,
  "fee" NUMERIC(24, 8) NOT NULL,
  "realized_pnl" NUMERIC(24, 8),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_paper_trades_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_paper_trades_order_id_fkey" FOREIGN KEY ("order_id")
    REFERENCES "quant_paper_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_paper_trades_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "quant_paper_trades_user_created_idx"
  ON "quant_paper_trades"("user_id", "created_at" DESC);
