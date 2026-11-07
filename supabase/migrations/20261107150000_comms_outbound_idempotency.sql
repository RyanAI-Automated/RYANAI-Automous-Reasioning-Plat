-- Mirror the Prisma outbound-idempotency migration in the Supabase SQL chain.
-- The local Supabase integration database is provisioned from this directory,
-- so the field must exist here before Prisma-backed Comms tests run.
ALTER TABLE public.communication_messages
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS communication_messages_idempotency_key_key
  ON public.communication_messages (idempotency_key);
