-- Explicit application schema migration.
-- Communication tables mirror prisma/schema.prisma and the legacy startup DDL.
CREATE TABLE IF NOT EXISTS "communication_conversations" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "external_address" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "communication_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "communication_conversations_channel_address_key" UNIQUE ("channel", "external_address")
);

CREATE TABLE IF NOT EXISTS "communication_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "provider_message_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'received',
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "communication_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "communication_messages_provider_message_id_key" UNIQUE ("provider_message_id"),
  CONSTRAINT "communication_messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "communication_conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "communication_messages_conversation_created_idx"
  ON "communication_messages" ("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "communication_messages_status_created_idx"
  ON "communication_messages" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "communication_conversations_channel_updated_idx"
  ON "communication_conversations" ("channel", "updated_at");

-- LangGraph.js @langchain/langgraph-checkpoint-postgres 1.1.2 schema.
-- The package's migration array has versions 0..5; v=5 adds task_path.
CREATE TABLE IF NOT EXISTS "checkpoint_migrations" (
  "v" INTEGER NOT NULL,
  CONSTRAINT "checkpoint_migrations_pkey" PRIMARY KEY ("v")
);

CREATE TABLE IF NOT EXISTS "checkpoints" (
  "thread_id" TEXT NOT NULL,
  "checkpoint_ns" TEXT NOT NULL DEFAULT '',
  "checkpoint_id" TEXT NOT NULL,
  "parent_checkpoint_id" TEXT,
  "type" TEXT,
  "checkpoint" JSONB NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "checkpoints_pkey" PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id")
);

CREATE TABLE IF NOT EXISTS "checkpoint_blobs" (
  "thread_id" TEXT NOT NULL,
  "checkpoint_ns" TEXT NOT NULL DEFAULT '',
  "channel" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "blob" BYTEA,
  CONSTRAINT "checkpoint_blobs_pkey" PRIMARY KEY ("thread_id", "checkpoint_ns", "channel", "version")
);

CREATE TABLE IF NOT EXISTS "checkpoint_writes" (
  "thread_id" TEXT NOT NULL,
  "checkpoint_ns" TEXT NOT NULL DEFAULT '',
  "checkpoint_id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "idx" INTEGER NOT NULL,
  "channel" TEXT NOT NULL,
  "type" TEXT,
  "blob" BYTEA NOT NULL,
  "task_path" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "checkpoint_writes_pkey" PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "idx")
);

ALTER TABLE "checkpoint_blobs" ALTER COLUMN "blob" DROP NOT NULL;
ALTER TABLE "checkpoint_writes" ADD COLUMN IF NOT EXISTS "task_path" TEXT NOT NULL DEFAULT '';

-- Mark the package's ordered migrations as applied. Existing versions are
-- preserved; an already-initialized checkpointer can safely run this migration.
INSERT INTO "checkpoint_migrations" ("v")
VALUES (0), (1), (2), (3), (4), (5)
ON CONFLICT ("v") DO NOTHING;
