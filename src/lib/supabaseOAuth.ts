import { DEFAULT_SUPABASE_URL } from '@/lib/supabase';

/** Public OAuth 2.1 / OIDC metadata; no client secrets or signing keys are bundled. */
export const SUPABASE_OAUTH_ENDPOINTS = Object.freeze({
  authorization: `${DEFAULT_SUPABASE_URL}/auth/v1/oauth/authorize`,
  token: `${DEFAULT_SUPABASE_URL}/auth/v1/oauth/token`,
  jwks: `${DEFAULT_SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  openidConfiguration: `${DEFAULT_SUPABASE_URL}/auth/v1/.well-known/openid-configuration`,
  authorizationServerMetadata: `${DEFAULT_SUPABASE_URL}/.well-known/oauth-authorization-server/auth/v1`,
  consentPath: '/oauth/consent',
});
