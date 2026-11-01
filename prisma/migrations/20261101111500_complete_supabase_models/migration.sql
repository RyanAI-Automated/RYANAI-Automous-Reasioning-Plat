-- Complete the Prisma migration history for the Supabase-integrated models.
-- The initial migration created the legacy session message table as "messages".
-- The current Prisma model maps it to "session_messages", while ChatSqlMessage
-- owns the "messages" table. Preserve existing session rows by renaming the
-- original table before creating the chat message table.
DO $$
BEGIN
  IF to_regclass('public.session_messages') IS NULL
     AND to_regclass('public.messages') IS NOT NULL THEN
    ALTER TABLE "messages" RENAME TO "session_messages";
  END IF;

  IF to_regclass('public.session_messages') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.session_messages')
        AND conname = 'messages_pkey'
    ) THEN
      ALTER TABLE "session_messages"
        RENAME CONSTRAINT "messages_pkey" TO "session_messages_pkey";
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.session_messages')
        AND conname = 'messages_session_id_fkey'
    ) THEN
      ALTER TABLE "session_messages"
        RENAME CONSTRAINT "messages_session_id_fkey" TO "session_messages_session_id_fkey";
    END IF;

    IF to_regclass('public.messages_session_id_idx') IS NOT NULL
       AND to_regclass('public.session_messages_session_id_idx') IS NULL THEN
      ALTER INDEX "messages_session_id_idx"
        RENAME TO "session_messages_session_id_idx";
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "profiles" (
  "id" UUID NOT NULL,
  "email" TEXT,
  "full_name" TEXT,
  "avatar_url" TEXT,
  "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'New Thread',
  "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4.6',
  "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "model" TEXT,
  "steps" JSONB,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "memory_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'preference',
  "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_entries_user_id_key_key" UNIQUE ("user_id", "key")
);

CREATE TABLE IF NOT EXISTS "scheduled_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "prompt" TEXT NOT NULL,
  "run_at" TIMESTAMP(3) NOT NULL,
  "interval_minutes" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'active',
  "last_run_at" TIMESTAMP(3),
  "last_result" TEXT,
  "last_error" TEXT,
  "locked_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pending_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "tool" TEXT NOT NULL,
  "args" JSONB NOT NULL,
  "summary" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "decided_at" TIMESTAMP(3),
  "decided_by" TEXT,
  "result" TEXT,
  CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "conversations_user_id_idx"
  ON "conversations"("user_id");
CREATE INDEX IF NOT EXISTS "messages_conversation_id_idx"
  ON "messages"("conversation_id");
CREATE INDEX IF NOT EXISTS "memory_entries_user_id_idx"
  ON "memory_entries"("user_id");
CREATE INDEX IF NOT EXISTS "scheduled_tasks_status_run_at_idx"
  ON "scheduled_tasks"("status", "run_at");
CREATE INDEX IF NOT EXISTS "scheduled_tasks_user_id_idx"
  ON "scheduled_tasks"("user_id");
CREATE INDEX IF NOT EXISTS "pending_actions_status_expires_at_idx"
  ON "pending_actions"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "pending_actions_user_id_idx"
  ON "pending_actions"("user_id");
