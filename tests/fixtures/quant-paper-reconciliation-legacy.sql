-- Seeded before 20261105233000_quant_paper_fill_reconciliation.
-- The original paper-order route wrote a filled order and its matching trade
-- in one database transaction. Keep a valid historical example and a deliberately
-- incomplete historical ledger so reconciliation must surface, not hide, drift.
INSERT INTO "users" ("id", "email", "created_at", "updated_at")
VALUES
  ('quant-recon-user-a', 'quant-recon-user-a@example.invalid', NOW(), NOW()),
  ('quant-recon-user-b', 'quant-recon-user-b@example.invalid', NOW(), NOW());

INSERT INTO "quant_paper_orders"
  ("id", "user_id", "client_order_id", "symbol", "side", "quantity",
   "reference_price", "fill_price", "fee", "status", "created_at")
VALUES
  ('quant-recon-legacy-full', 'quant-recon-user-a', 'legacy-client-full',
   'AAPL', 'buy', 10, 99, 100, 0.50, 'filled', NOW()),
  ('quant-recon-legacy-no-trade', 'quant-recon-user-a', 'legacy-client-no-trade',
   'MSFT', 'buy', 3, 49, 50, 0.15, 'filled', NOW());

INSERT INTO "quant_paper_trades"
  ("id", "order_id", "user_id", "symbol", "side", "quantity", "price", "fee", "created_at")
VALUES
  ('quant-recon-legacy-fill', 'quant-recon-legacy-full', 'quant-recon-user-a',
   'AAPL', 'buy', 10, 100, 0.50, NOW());
