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
    CHECK (
      ("filled_quantity" = 0 AND "average_fill_price" IS NULL) OR
      ("filled_quantity" > 0 AND "average_fill_price" IS NOT NULL AND "average_fill_price" > 0)
    );

-- Preserve compatibility with the existing atomic paper-fill route. The
-- current route writes a fully-filled order and a single fill row in one tx.
CREATE OR REPLACE FUNCTION public.quant_paper_order_fill_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'filled' AND NEW.filled_quantity = 0 AND NEW.remaining_quantity = 0 THEN
    NEW.filled_quantity := NEW.quantity;
    NEW.remaining_quantity := 0;
    NEW.average_fill_price := NEW.fill_price;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER quant_paper_order_fill_defaults_trigger
BEFORE INSERT ON public.quant_paper_orders
FOR EACH ROW EXECUTE FUNCTION public.quant_paper_order_fill_defaults();

ALTER TABLE "quant_paper_trades"
  ADD COLUMN "client_fill_id" VARCHAR(96);

UPDATE "quant_paper_trades"
SET "client_fill_id" = 'legacy:' || "id";

CREATE OR REPLACE FUNCTION public.quant_paper_trade_fill_id()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  order_client_id TEXT;
BEGIN
  -- Validate order ownership for every fill, including rows that provide an
  -- explicit idempotency key. Never let client_fill_id bypass account isolation.
  SELECT client_order_id INTO order_client_id
  FROM public.quant_paper_orders WHERE id = NEW.order_id AND user_id = NEW.user_id;
  IF order_client_id IS NULL THEN
    RAISE EXCEPTION 'paper fill references an unknown order';
  END IF;

  IF NEW.client_fill_id IS NULL OR NEW.client_fill_id = '' THEN
    NEW.client_fill_id := 'paper:' || order_client_id || ':' || NEW.id::text;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER quant_paper_trade_fill_id_trigger
BEFORE INSERT ON public.quant_paper_trades
FOR EACH ROW EXECUTE FUNCTION public.quant_paper_trade_fill_id();

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
