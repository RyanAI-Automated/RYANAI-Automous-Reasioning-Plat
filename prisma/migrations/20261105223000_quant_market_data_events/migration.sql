CREATE TABLE "quant_market_data_events" (
  "id" BIGSERIAL NOT NULL,
  "user_id" TEXT NOT NULL,
  "symbol" VARCHAR(15) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "feed" VARCHAR(16) NOT NULL,
  "timeframe" VARCHAR(16) NOT NULL,
  "event_timestamp" TIMESTAMPTZ(6) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "source" VARCHAR(16) NOT NULL DEFAULT 'stream',
  "bar" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "quant_market_data_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_market_data_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quant_market_data_events_source_check"
    CHECK ("source" IN ('stream', 'historical'))
);

CREATE UNIQUE INDEX "quant_market_data_events_dedupe_key"
  ON "quant_market_data_events"(
    "user_id", "provider", "feed", "timeframe", "symbol", "event_timestamp", "payload_hash"
  );
CREATE INDEX "quant_market_data_events_user_symbol_cursor_idx"
  ON "quant_market_data_events"("user_id", "symbol", "id" ASC);
CREATE INDEX "quant_market_data_events_user_symbol_time_idx"
  ON "quant_market_data_events"("user_id", "symbol", "event_timestamp" DESC);
