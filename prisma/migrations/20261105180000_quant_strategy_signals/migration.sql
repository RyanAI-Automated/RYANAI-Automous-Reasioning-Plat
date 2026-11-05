CREATE TABLE "quant_strategy_signals" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "market_data_import_id" TEXT NOT NULL,
  "strategy" VARCHAR(40) NOT NULL,
  "fast_window" SMALLINT NOT NULL,
  "slow_window" SMALLINT NOT NULL,
  "action" VARCHAR(8) NOT NULL,
  "reference_price" DECIMAL(18,8) NOT NULL,
  "previous_fast_sma" DECIMAL(18,8) NOT NULL,
  "previous_slow_sma" DECIMAL(18,8) NOT NULL,
  "fast_sma" DECIMAL(18,8) NOT NULL,
  "slow_sma" DECIMAL(18,8) NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL,
  "metadata" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_strategy_signals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_strategy_signals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_strategy_signals_import_id_fkey"
    FOREIGN KEY ("market_data_import_id") REFERENCES "quant_market_data_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_strategy_signals_windows_check"
    CHECK ("fast_window" >= 2 AND "slow_window" > "fast_window" AND "slow_window" <= 200),
  CONSTRAINT "quant_strategy_signals_action_check"
    CHECK ("action" IN ('buy', 'sell', 'hold'))
);

CREATE UNIQUE INDEX "quant_strategy_signals_user_import_strategy_windows_key"
  ON "quant_strategy_signals"("user_id", "market_data_import_id", "strategy", "fast_window", "slow_window");
CREATE INDEX "quant_strategy_signals_user_generated_idx"
  ON "quant_strategy_signals"("user_id", "generated_at" DESC);
