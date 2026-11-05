# Neon audiobook database and Supabase identity bridge

## Decision

Keep Supabase Auth as the sole identity authority and Supabase Storage as the sole audiobook artifact store. Use a separate Neon PostgreSQL database for audiobook projects, chapters, and durable render jobs only. Do not repoint RyanAI's general `DATABASE_URL` or run the existing Supabase-oriented Prisma migration history against Neon.

Approved staging target:

- Neon project: `neon-byzantium-bucket` (`ancient-frost-85604914`)
- Region/version: AWS US East 1 / PostgreSQL 18
- Shared audiobook staging branch: `audiobook-staging` (`br-rapid-frog-bbi455gu`)
- Dedicated app setting: `AUDIOBOOK_DATABASE_URL` (pooled)
- Migration setting: `AUDIOBOOK_DATABASE_URL_UNPOOLED` (direct)

## Identity flow

1. A request enters RyanAI's existing `requireUser` guard.
2. The guard calls Supabase Auth `getUser(accessToken)` and rejects invalid, expired, anonymous, or unverifiable sessions. Do not decode a bearer token and treat its claims as verified.
3. An authenticated audiobook project creation calls `ensureSupabaseIdentity` with only the verified Supabase user UUID.
4. Neon upserts that UUID into `public.supabase_identities`. The table stores no email, name, app/user metadata, role, password, access token, refresh token, session, or other Supabase credential.
5. Audiobook project and render-job foreign keys reference the opaque identity row. All reads and writes remain scoped to the same verified user UUID from the request.
6. Audio bytes continue to be uploaded to and downloaded from the existing private Supabase Storage bucket through the existing server-side service-role integration. Supabase Storage policies and credentials are not moved to Neon.

The identity row is an ownership anchor, not an authentication session or authorization claim. Each HTTP request still verifies the Supabase token through Supabase Auth. The API and render worker use a separate server-only Neon database connection; browsers never receive it.

## Why this is application-mediated, not a database trigger

Supabase Auth and Neon PostgreSQL are separate databases. A trigger on Supabase `auth.users` cannot directly maintain a row in Neon without a separately secured cross-database mechanism. The old `20261102123000_supabase_auth_identity_bridge` migration is for a Supabase-hosted database where `auth.users` is in the same Postgres instance; it must not be replayed on the Neon audiobook database.

RyanAI performs the bridge only after the existing Auth server has verified the bearer token. Identity creation is idempotent and occurs on first audiobook project creation, not on every authenticated API call.

## Data and deletion boundaries

- Supabase remains authoritative for login, session validity, roles, and account metadata.
- No Supabase Auth rows, passwords, tokens, emails, app metadata, or user metadata are copied.
- Deleting a Neon identity anchor is restricted while audiobook records reference it. Account-deletion and artifact-retention cleanup must be designed as a separate coordinated workflow across Supabase Auth, Neon and Supabase Storage; do not automatically cascade-delete assets or records in this bridge.
- A Supabase identity that is no longer valid cannot pass the existing request authentication guard. The bridge does not mint or accept an alternative RyanAI login token.

## Migration isolation

The Neon audiobook schema is maintained independently under `prisma/audiobook/`. It is not part of the main `prisma/migrations/` chain, which includes Supabase-specific migrations and must continue serving the existing main database.

- Run `npm run db:audiobook:generate` to generate the isolated Prisma client.
- Run `npm run db:audiobook:status` to inspect pending migrations.
- Run `npm run db:audiobook:migrate` only against an explicitly approved Neon branch, using the direct unpooled URL for migration operations.
- Normal API and worker requests use the pooled URL.
- The shared `audiobook-staging` branch is not a migration test target. Test schema changes on a disposable child branch first.

## Verification and test evidence

The design must pass:
- Identity upsert contains only `id`, is idempotent, and rejects malformed/non-UUID subjects before any write.
- A DB outage prevents audiobook project creation (fail closed).
- Unauthenticated requests do not create identity rows or access audiobook data.
- A project cannot be created without an identity row.
- User-scoped reads cannot return another user's projects or jobs.
- Duplicate idempotency keys and multiple active renders remain blocked.
- Migration DDL does not refer to `auth.users`, Supabase roles, or the Supabase Storage schema.

Before staging migration approval, run the migration on a disposable Neon child branch and record the Prisma status, schema tree, constraints, and test results. No migration should be run on `audiobook-staging` until that evidence is reviewed.
