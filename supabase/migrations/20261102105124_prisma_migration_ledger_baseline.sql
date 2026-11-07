-- Reconcile the direct Supabase-applied Prisma migrations with Prisma's own deployment ledger.
CREATE TABLE IF NOT EXISTS public."_prisma_migrations" (
  "id" VARCHAR(36) NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);
ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."_prisma_migrations" TO service_role;
COMMENT ON TABLE public."_prisma_migrations" IS
  'Prisma migration ledger. Access is restricted to the database owner and server migration identity.';
