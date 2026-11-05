ALTER TABLE "quant_paper_orders"
  ADD COLUMN "filled_quantity" NUMERIC(24, 8) NOT NULL DEFAULT 0,
  ADD COLUMN "remaining_quantity" NUMERIC(24, 8) NOT NULL DEFAULT 0,
  ADD COLUMN "average_fill_price" NUMERIC(24, 8),
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing paper orders were created as fully filled and have one matching trade row.
UPDATE "quant_paper_orders"
SET "filled_quantity" = "quantity",
    "remaining_quantity" = 0,
    "average_fill_price" = "fill_price",
    "updated_at" = "created_at";

ALTER TABLE "quant_paper_orders"
  ADD CONSTRAINT "quant_paper_orders_fill_quantities_check"
    CHECK (
      "filled_quantity" >= 0 AND
      "remaining_quantity" >= 0 AND
      ABS(("filled_quantity" + "remaining_quantity") - "quantity") <= 0.00000001
    ),
  ADD CONSTRAINT "quant_paper_orders_average_fill_check"
    CHECK ("filled_quantity" = 0 OR "average_fill_price" > 0);

ALTER TABLE "quant_paper_trades"
  ADD COLUMN "client_fill_id" VARCHAR(96);

UPDATE "quant_paper_trades"
SET "client_fill_id" = 'legacy:' || "id";

ALTER TABLE "quant_paper_trades"
  ALTER COLUMN "client_fill_id" SET NOT NULL;

CREATE UNIQUE INDEX "quant_paper_trades_user_client_fill_id_key"
  ON "quant_paper_trades"("user_id", "client_fill_id");

CREATE INDEX "quant_paper_trades_user_order_idx"
  ON "quant_paper_trades"("user_id", "order_id");

-- Reserve explicit lifecycle values for future simulated partial/cancelled fills.
ALTER TABLE "quant_paper_orders"
  DROP CONSTRAINT "quant_paper_orders_status_check",
  ADD CONSTRAINT "quant_paper_orders_status_check"
    CHECK ("status" IN ('accepted', 'partially_filled', 'filled', 'cancelled', 'rejected'));
