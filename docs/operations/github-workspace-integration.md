# RyanAI GitHub workspace integration

## Implementation status

The repository now contains a server-side GitHub App user-authorization flow and a browser status/connect/disconnect UI. The connection remains **not configured** until a GitHub App is registered and all required server settings are supplied through the approved secret-management process.

A connection is displayed as verified only after the server verifies both:
- the authenticated GitHub account ID returned by `GET https://api.github.com/user`; and
- read permission for the exact official repository `RyanAI-Automated/RYANAI-Automous-Reasioning-Plat`.

The implemented application capability is read-only repository status. It does not create branches, push commits, open pull requests, merge or deploy.

## GitHub App registration

1. Register a GitHub App owned by the organization that owns the official repository.
2. Enable user-to-server authorization and expiring user access tokens.
3. Grant only the minimum repository permissions required by the current status integration. Repository metadata and contents read are needed to inspect the selected repository; the authorization code also verifies the repository's `pull` permission. Do not add write permissions for this UI-only flow.
4. Restrict installation to the official repository.
5. Register the callback URL exactly as configured on the server. It must end with `/api/github/callback`; production callback and return URLs must use HTTPS.
6. Do not enable a connected state until a real authorization handshake and the repository permission check succeed.

## Server configuration names

Supply these variables only through the approved server-side secret/configuration system. Do not put their values into source control, Vite variables, browser storage, screenshots, issue comments or chat.

- `GITHUB_APP_CLIENT_ID`: GitHub App client ID.
- `GITHUB_APP_CLIENT_SECRET`: GitHub App client secret.
- `GITHUB_APP_CALLBACK_URL`: exact HTTPS API callback, for example `https://<api-host>/api/github/callback`.
- `GITHUB_APP_RETURN_URL`: trusted frontend origin/path to receive a non-sensitive `github=connected|denied|error` result.
- `GITHUB_TOKEN_ENCRYPTION_KEY`: 32 random bytes encoded as 64 hexadecimal characters; dedicated to server-side credential encryption and separate from the App client secret.

The application fails closed when any setting is missing or malformed. No values are generated or committed by the repository code.

## Security and token lifecycle

- The authenticated RyanAI user starts the flow through `POST /api/github/connect`.
- The server creates a high-entropy, ten-minute, one-time state value and an S256 PKCE verifier. It stores only the SHA-256 state hash and an AES-256-GCM encrypted verifier, bound to the authenticated RyanAI user.
- Only `GET /api/github/callback` is public. It must claim and delete the matching, unexpired state row before exchanging the code. A repeated, expired or unknown state is rejected. Callback access logging is disabled so codes and state query parameters are not written to request logs.
- The server exchanges the code with the registered callback URI and PKCE verifier, then verifies the GitHub account and official repository before persisting credentials.
- Access and refresh tokens are encrypted at rest with AES-256-GCM. Raw tokens are never returned to the browser or included in application status messages.
- User access tokens are refreshed server-side when nearing expiry. A refresh stores the rotated refresh token using a conditional update to avoid concurrent use of a single-use refresh token.
- Disconnect deletes the local credential record and attempts to revoke the entire GitHub App authorization grant. The UI distinguishes confirmed remote revocation from a local disconnect whose remote revocation could not be confirmed.
- The migration creates server-only persistence tables with RLS enabled and direct PUBLIC, anon and authenticated privileges revoked.

## API surface

- `GET /api/github/status`: verified connection state for the signed-in RyanAI user.
- `GET /api/github/connect`: returns a GitHub authorization URL for the signed-in RyanAI user.
- `GET /api/github/callback`: one-time, state-bound PKCE callback.
- `POST /api/github/disconnect`: disconnect and attempt remote grant revocation.

The status API returns only GitHub login, official repository identity, permission metadata and token expiry metadata. It never returns credentials.

## Verification required before activation

- Run the exact-head unit/component tests, typecheck, lint, dependency checks and security scans.
- Apply the GitHub connection migration only through the separately approved migration workflow, after reviewed backup/rollback evidence.
- Register the App and configure server variables through the owner-controlled secret system.
- Complete a real, owner-authorized authorization callback and verify the official repository read permission.
- Verify token refresh and remote revocation against the registered test App before treating the integration as operational.
- Confirm the frontend and API callbacks use their production HTTPS origins.

A merged code change or configured environment is not proof of a working OAuth session. No App registration, credential creation, secret update, migration execution or deployment is authorized by this code-only work.
