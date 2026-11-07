-- Plugin provider authorization state is server-only.
-- No browser role may read tokens, PKCE verifier material, or connection records.
CREATE TABLE public.plugin_provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  provider_id VARCHAR(64) NOT NULL CHECK (provider_id ~ '^[a-z][a-z0-9-]{1,63}$'),
  external_account_id TEXT,
  display_label VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'reauthorization_required', 'revocation_pending', 'revoked', 'error')),
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  access_token_expires_at TIMESTAMPTZ(6),
  refresh_token_expires_at TIMESTAMPTZ(6),
  granted_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  connection_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected_at TIMESTAMPTZ(6),
  revoked_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT plugin_connection_revoked_timestamp_check
    CHECK ((status <> 'revoked') OR revoked_at IS NOT NULL),
  CONSTRAINT plugin_connection_connected_token_check
    CHECK ((status <> 'connected') OR encrypted_access_token IS NOT NULL)
);
CREATE UNIQUE INDEX plugin_provider_connections_owner_provider_key
  ON public.plugin_provider_connections (owner_user_id, provider_id);
CREATE INDEX plugin_provider_connections_owner_status_idx
  ON public.plugin_provider_connections (owner_user_id, status, updated_at DESC);
CREATE INDEX plugin_provider_connections_provider_status_idx
  ON public.plugin_provider_connections (provider_id, status, updated_at DESC);

CREATE TABLE public.plugin_oauth_states (
  state_hash VARCHAR(64) PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  owner_user_id TEXT NOT NULL,
  provider_id VARCHAR(64) NOT NULL CHECK (provider_id ~ '^[a-z][a-z0-9-]{1,63}$'),
  encrypted_code_verifier TEXT NOT NULL,
  requested_scopes TEXT[] NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX plugin_oauth_states_expires_idx ON public.plugin_oauth_states (expires_at);
CREATE INDEX plugin_oauth_states_owner_provider_idx
  ON public.plugin_oauth_states (owner_user_id, provider_id);

CREATE TABLE public.plugin_authorization_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  provider_id VARCHAR(64) NOT NULL,
  connection_id UUID REFERENCES public.plugin_provider_connections(id) ON DELETE SET NULL,
  event_type VARCHAR(64) NOT NULL
    CHECK (event_type IN (
      'authorization_started',
      'authorization_completed',
      'authorization_failed',
      'scopes_rejected',
      'token_refreshed',
      'revocation_requested',
      'revocation_confirmed',
      'revocation_pending',
      'connection_reauthorized'
    )),
  actor_user_id TEXT NOT NULL,
  request_id VARCHAR(128),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX plugin_authorization_events_owner_created_idx
  ON public.plugin_authorization_events (owner_user_id, created_at DESC);
CREATE INDEX plugin_authorization_events_connection_created_idx
  ON public.plugin_authorization_events (connection_id, created_at DESC);

-- The OAuth state is single-use and removed atomically by callback handlers.
-- Provider authorization audit is append-only.
CREATE OR REPLACE FUNCTION public.reject_plugin_authorization_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'plugin_authorization_events is append-only';
END;
$$;
CREATE TRIGGER plugin_authorization_events_immutable
  BEFORE UPDATE OR DELETE ON public.plugin_authorization_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_plugin_authorization_event_mutation();

DO $plugin_authorization_privileges$
DECLARE
  table_name TEXT;
  browser_role TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'plugin_provider_connections',
    'plugin_oauth_states',
    'plugin_authorization_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, browser_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
    END IF;
  END LOOP;
END;
$plugin_authorization_privileges$;
