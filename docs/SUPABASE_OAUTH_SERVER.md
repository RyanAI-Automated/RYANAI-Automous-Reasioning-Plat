# RyanAI Supabase OAuth 2.1 Server

RyanAI uses the Supabase project `narsvpwymvlrhurqbthu` as its OAuth 2.1 / OpenID Connect authorization server. Supabase Auth owns the authorization-code flow, PKCE validation, token creation, refresh-token rotation, and signing. RyanAI provides the user authentication boundary and the explicit consent screen.

## Public endpoints

| Purpose | Endpoint |
|---|---|
| Authorization | `https://narsvpwymvlrhurqbthu.supabase.co/auth/v1/oauth/authorize` |
| Token | `https://narsvpwymvlrhurqbthu.supabase.co/auth/v1/oauth/token` |
| JWKS | `https://narsvpwymvlrhurqbthu.supabase.co/auth/v1/.well-known/jwks.json` |
| OIDC discovery | `https://narsvpwymvlrhurqbthu.supabase.co/auth/v1/.well-known/openid-configuration` |
| OAuth authorization-server metadata | `https://narsvpwymvlrhurqbthu.supabase.co/.well-known/oauth-authorization-server/auth/v1` |
| RyanAI authorization UI | `/oauth/consent` |

## Supabase Dashboard configuration

The hosted project must have OAuth 2.1 Server enabled in **Authentication → OAuth Server**. Set:

- Authorization path: `/oauth/consent`
- Dynamic client registration: **off** unless a separately reviewed MCP integration explicitly requires it.
- Site URL: the canonical deployed RyanAI frontend origin. Add approved development origins to the redirect allow-list only when required.

The local Supabase configuration in `supabase/config.toml` mirrors the OAuth Server setting for local development. It does not update the hosted project's Dashboard configuration.

## Consent and client registration

The frontend route reads the `authorization_id` Supabase Auth supplies to the configured authorization path. It requires an existing signed-in, non-anonymous Supabase session, revalidates the user with Supabase Auth, fetches client name / redirect URI / requested scopes through `supabase.auth.oauth.getAuthorizationDetails()`, and requires an explicit user decision. Approval or denial is submitted with the corresponding Supabase SDK method. RyanAI checks that the callback returned after a decision matches the registered callback shown on the consent screen. Supabase Auth generates the authorization code and applies PKCE.

Register third-party clients explicitly in **Authentication → OAuth Apps**. Use an exact callback URI and a public client with `token_endpoint_auth_method=none` for browser/mobile clients, or a confidential client for server-side applications. Store confidential client secrets only in a server-side secret manager. Never place them in a `VITE_*` variable or browser bundle.

Request only the scopes a client needs (for example, `openid email profile`). Supabase requires an asymmetric JWT signing key (RS256 / ES256) for OIDC ID tokens when the `openid` scope is requested; verify the project's signing-key configuration before enabling OIDC clients that request ID tokens.

## Data API and API access

OAuth access tokens are Supabase Auth bearer tokens. A client calls the Supabase Data API with the project publishable key in `apikey` and the OAuth access token in `Authorization: Bearer`. Existing row-level security remains the authority for access to `profiles`, `conversations`, `messages`, and `memory_entries`; do not bypass it with a service-role key.

RyanAI's API verifies Supabase sessions with Supabase Auth's `getUser(token)` before attaching a user identity to protected requests. OAuth-issued user tokens therefore follow the same verified-user path; authorization is not based on decoding an unverified JWT or trusting browser metadata.

## Operational verification

Before advertising the hosted OAuth server as live:

1. Verify the Dashboard switch is enabled and the authorization path is saved.
2. Fetch the OIDC discovery document and confirm `issuer`, authorization/token endpoints, and `jwks_uri` match this project.
3. Register a test OAuth client with a dedicated callback URI.
4. Run the authorization-code flow with PKCE, approve and deny once each, and verify the returned `state` and callback.
5. Exchange the code, validate the returned access token against the advertised issuer/JWKS, and verify the user's Data API requests are restricted by RLS.
6. Confirm token refresh and client revocation behavior.

Do not use the service-role key for third-party OAuth clients or expose it in the frontend.
