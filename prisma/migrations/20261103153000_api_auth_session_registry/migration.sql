CREATE TABLE IF NOT EXISTS "api_auth_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "email" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "revoked_at" TIMESTAMPTZ,
  CONSTRAINT "api_auth_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "api_auth_sessions_session_id_key" ON "api_auth_sessions" ("session_id");
CREATE INDEX IF NOT EXISTS "api_auth_sessions_user_last_seen_idx" ON "api_auth_sessions" ("user_id", "last_seen_at" DESC);
CREATE INDEX IF NOT EXISTS "api_auth_sessions_revoked_last_seen_idx" ON "api_auth_sessions" ("revoked_at", "last_seen_at" DESC);
