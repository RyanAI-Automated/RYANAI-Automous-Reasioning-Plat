# Supabase PostgreSQL TLS trust on Render

RyanAI's production API image bundles the public **Supabase Root 2021 CA** at
`/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt`. The image installs
it into the Alpine trust store and configures Node.js 24 to use both system and
additional CA certificates. The app also passes the same path into the
PostgreSQL connection URL as `sslrootcert` with `sslmode=verify-full` and
Prisma's strict certificate acceptance setting.

A `SELF_SIGNED_CERT_IN_CHAIN` or `UNABLE_TO_VERIFY_LEAF_SIGNATURE` error means
the server certificate chain is not trusted. Do not work around this by setting
`NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized: false`, or otherwise
disabling certificate verification.

## Standard deployment

No extra Render secret file is required when Supabase is using its Root 2021 CA.
The certificate is public trust material, not a private key or database
credential. Its source and SHA-256 fingerprint are documented in
[`certs/supabase/README.md`](../../certs/supabase/README.md).

The API image sets:

- `NODE_USE_SYSTEM_CA=1` to use the container's installed system roots.
- `NODE_EXTRA_CA_CERTS` to add the bundled Supabase Root 2021 CA.
- `SUPABASE_SSL_ROOT_CERT_PATH` so the Session Pooler URL resolver passes the
  same certificate to node-postgres and Prisma.
- `sslmode=verify-full` and `sslaccept=strict` so CA and hostname checks remain
  enabled.

The API container runs `scripts/verify-node-ca.sh` before starting. If
`NODE_EXTRA_CA_CERTS` is missing, unreadable, or not PEM certificate material,
the container refuses to start.

## If Supabase changes the project CA

1. In the correct Supabase project, open **Database → SSL Configuration** and
   download the current root CA certificate. Do not guess or substitute a
   certificate from another project.
2. Verify its subject, validity, and SHA-256 fingerprint against the project
   dashboard or Supabase's published documentation.
3. Prefer updating the versioned certificate in
   `certs/supabase/prod-ca-2021.crt` through a reviewed GitHub PR. Do not commit
   database credentials or private keys.
4. If an emergency operator-managed certificate is required, upload the
   verified PEM as a Render Secret File and set both variables on `ryanai-api`:
   ```env
   NODE_EXTRA_CA_CERTS=/etc/secrets/supabase-root-ca.pem
   SUPABASE_SSL_ROOT_CERT_PATH=/etc/secrets/supabase-root-ca.pem
   ```
5. Restart/redeploy only after approval. Node reads `NODE_EXTRA_CA_CERTS` when
   the process starts, so changing it requires a new process.

Keep `DATABASE_URL` and all credentials in Render's protected environment
settings. Never paste them into Git, issue comments, pull requests, or chat.

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
database connectivity. Never disable TLS verification to make a health check
pass.
