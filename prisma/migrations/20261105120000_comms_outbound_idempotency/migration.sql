-- Prevent duplicate external dispatch when browser/network retries repeat a send request.
-- Nullable for backwards compatibility with existing communication history.
ALTER TABLE "communication_messages" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "communication_messages_idempotency_key_key" ON "communication_messages" ("idempotency_key");
