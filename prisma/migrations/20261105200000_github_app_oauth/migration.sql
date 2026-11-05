-- GitHub App user authorization is server-only. Browser roles must not
-- read credentials or one-time PKCE state. Server API uses the privileged
-- PostgreSQL connection and enforces the authenticated RyanAI user ID.
CREATE TABLE public.github_app_connections (
  user_id TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL,
  github_login VARCHAR(120) NOT NULL,
  repository_id TEXT NOT NULL,
  repository_full_name VARCHAR(255) NOT NULL,
  repository_permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  access_token_expires_at TIMESTAMPTZ(6),
  refresh_token_expires_at TIMESTAMPTZ(6),
  connected_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.github_oauth_states (
  state_hash VARCHAR(64) PRIMARY KEY,
  user_id TEXT NOT NULL,
  encrypted_code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX github_oauth_states_expires_idx ON public.github_oauth_states(expires_at);
CREATE INDEX github_oauth_states_user_idx ON public.github_oauth_states(user_id);

ALTER TABLE public.github_app_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.github_app_connections FROM PUBLIC;
REVOKE ALL ON TABLE public.github_oauth_states FROM PUBLIC;
DO $github_roles$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.github_app_connections FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE public.github_oauth_states FROM %I', role_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.github_app_connections TO service_role;
    GRANT ALL ON TABLE public.github_oauth_states TO service_role;
  END IF;
END;
$github_roles$;
