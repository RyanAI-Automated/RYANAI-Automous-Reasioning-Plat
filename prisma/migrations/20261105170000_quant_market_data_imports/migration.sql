CREATE TABLE "quant_market_data_imports" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "symbol" VARCHAR(15) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "feed" VARCHAR(16) NOT NULL,
  "timeframe" VARCHAR(16) NOT NULL,
  "adjustment" VARCHAR(16) NOT NULL,
  "bar_count" INTEGER NOT NULL,
  "first_bar_at" TIMESTAMPTZ(6) NOT NULL,
  "last_bar_at" TIMESTAMPTZ(6) NOT NULL,
  "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_stale" BOOLEAN NOT NULL DEFAULT FALSE,
  "bars" JSONB NOT NULL,
  "provenance" JSONB NOT NULL,
  CONSTRAINT "quant_market_data_imports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_market_data_imports_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_market_data_imports_bar_count_check" CHECK ("bar_count" BETWEEN 30 AND 1000),
  CONSTRAINT "quant_market_data_imports_symbol_check" CHECK ("symbol" ~ '^[A-Z0-9.-]{1,15}$')
);

CREATE INDEX "quant_market_data_imports_user_symbol_fetched_idx"
  ON "quant_market_data_imports"("user_id", "symbol", "fetched_at" DESC);
