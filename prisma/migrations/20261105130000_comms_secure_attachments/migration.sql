ALTER TABLE "communication_conversations" ADD COLUMN IF NOT EXISTS "owner_user_id" UUID;
CREATE INDEX IF NOT EXISTS "communication_conversations_owner_updated_idx" ON "communication_conversations" ("owner_user_id","updated_at");
CREATE TABLE IF NOT EXISTS "communication_attachments" (
 "id" TEXT PRIMARY KEY,"communication_message_id" TEXT NOT NULL,"owner_user_id" UUID NOT NULL,
 "bucket_id" TEXT NOT NULL DEFAULT 'ryanai-comms-attachments',"object_name" TEXT NOT NULL UNIQUE,
 "file_name" TEXT NOT NULL,"mime_type" TEXT NOT NULL,"size" BIGINT NOT NULL CHECK ("size">0),
 "source" TEXT NOT NULL,"provider_media_id" TEXT,"created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "communication_attachments_message_fkey" FOREIGN KEY ("communication_message_id") REFERENCES "communication_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "communication_attachments_owner_created_idx" ON "communication_attachments" ("owner_user_id","created_at");
CREATE INDEX IF NOT EXISTS "communication_attachments_message_created_idx" ON "communication_attachments" ("communication_message_id","created_at");
