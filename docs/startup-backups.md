# RyanAI startup backups

The API image includes an optional, non-blocking backup step before the Fastify
server starts. It is disabled unless `BACKUP_ON_STARTUP=true`.

## Required setup

1. In the existing Supabase project, create a **private** Storage bucket for
   backups (for example, `ryanai-backups`). Do not make it public.
2. Configure these environment variables on the API service:
   - `BACKUP_ON_STARTUP=true`
   - `DATABASE_URL`: PostgreSQL direct connection URL suitable for `pg_dump`
     (prefer the direct database connection, not a transaction-mode pooler).
   - `SUPABASE_URL`: project URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: server-side secret only; never expose it to
     the browser, commit it, or include it in logs.
   - `SUPABASE_BACKUP_BUCKET`: name of the existing private destination bucket.
3. Optional: set `RYANAI_BACKUP_STORAGE_BUCKETS` to a comma-separated list of
   existing source Storage buckets whose objects should also be copied.

The backup script does not create buckets, change database schema, rotate
secrets, or change Render/Supabase configuration. Those setup actions remain
explicit operator steps. Do not use the destination bucket as a source bucket.

## What is backed up

Each run writes a timestamped prefix under `ryanai-startup/` in the destination
bucket containing:

- `database.dump`: PostgreSQL custom-format dump including schema and data.
- `manifest.json`: timestamp, Render service/commit identifiers, selected
  environment-variable presence flags, and source Storage bucket names.
- `storage/<bucket>/<object-path>`: copies of objects from each configured
  source bucket.

The manifest does not contain environment-variable values or credentials.
Redis contents, provider secrets, local ephemeral files, and Render's full
service configuration are not included. Configuration is represented only by
safe deployment identifiers and variable-presence flags; recover secrets from
their original secret manager, not from backups.

## Failure and retention behavior

- If disabled or required variables are missing, the backup is skipped.
- If a backup fails, a sanitized warning is logged and API startup continues.
  A running API therefore does **not** prove a backup succeeded.
- Every successful startup creates a new backup prefix. The script never
  deletes old backups. Configure a retention/lifecycle policy for the private
  bucket after deciding the required recovery window.
- Run and verify a restore drill before relying on these backups for recovery.
  A dump upload alone is not proof that a database can be restored.

## Manual invocation

Inside the API container, run:

```sh
BACKUP_ON_STARTUP=true node scripts/backup-on-startup.mjs
```

The Docker image installs `postgresql-client` for `pg_dump` and invokes the
script before the API process. No deployment is triggered by this change.
