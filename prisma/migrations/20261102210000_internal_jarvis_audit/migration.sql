CREATE TABLE IF NOT EXISTS "jarvis_audit_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "resource_id" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "jarvis_audit_events_created_at_idx" ON "jarvis_audit_events" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "jarvis_audit_events_actor_created_idx" ON "jarvis_audit_events" ("actor_id", "created_at" DESC);
