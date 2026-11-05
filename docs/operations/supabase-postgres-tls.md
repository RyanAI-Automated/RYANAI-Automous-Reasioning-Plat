# Supabase PostgreSQL TLS trust on Render

RyanAI's API uses Node.js 24 and node-postgres to check PostgreSQL during startup. A
`SELF_SIGNED_CERT_IN_CHAIN` or `UNABLE_TO_VERIFY_LEAF_SIGNATURE` error means the
server certificate chain is not trusted by the runtime. Do not work around this
by setting `NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized: false`, or
otherwise disabling certificate verification.

## Configure the Supabase root certificate

1. In the correct Supabase project, open **Database → SSL Configuration** and
   download that project's root CA certificate. Use the certificate supplied by
   the project dashboard; do not guess a CA or substitute a certificate from
   another project.
2. In Render, open the **ryanai-api** service and select **Environment → Secret
   Files → Add Secret File**.
3. Upload the certificate as a PEM file, for example
   `supabase-prod-ca.pem`. Render makes it available inside the Docker service
   at `/etc/secrets/supabase-prod-ca.pem`.
4. Add the environment variable:
   ```env
   NODE_EXTRA_CA_CERTS=/etc/secrets/supabase-prod-ca.pem
   ```
5. Save the environment change and allow the service to restart/redeploy so the
   Node process reads the CA bundle at startup.

The certificate is public trust material, not a database password. Keep the
`DATABASE_URL` and all credentials in Render's protected environment settings.
Do not commit the downloaded certificate or database connection string to Git.

## Runtime behavior

- The API image sets `NODE_USE_SYSTEM_CA=1`, so Node.js 24 includes the
  container's installed operating-system CA store in its trusted roots.
- `NODE_EXTRA_CA_CERTS` adds the Supabase project CA to Node's normal trust
  bundle. Node reads it when the process starts.
- The API container entrypoint checks that a configured CA path is readable and
  contains PEM certificate material before launching the API.
- TLS certificate-chain and hostname verification remain enabled. An untrusted
  or mismatched certificate must continue to fail closed.

## Verification after an approved restart

Check the Render API logs for all of the following:

1. PostgreSQL initialization completes and the schema inspection succeeds.
2. Redis reports `PONG`.
3. The API starts listening.
4. `/readyz` and `/health` return HTTP 200 and report PostgreSQL, Redis, and
   the agent checkpointer as ready.
5. A separate disposable-database test confirms PostgreSQL `LISTEN/NOTIFY`
   works through the configured Session Pooler connection.

A successful Docker build or the presence of the CA file is not proof of live
database connectivity. Never disable TLS verification to make a health check pass.
