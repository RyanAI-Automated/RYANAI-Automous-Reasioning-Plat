# Supabase PostgreSQL root CA

This repository includes the **public Supabase Root 2021 CA** used to verify
Supabase Postgres and shared-pooler TLS chains. It is a public trust
certificate, not a private key or database credential.

- Upstream download: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
- Dashboard location: Project Settings → Database → SSL Configuration
- Subject / issuer: CN=Supabase Root 2021 CA, O=Supabase Inc
- Validity: 2021-04-28 10:56:53 UTC through 2031-04-26 10:56:53 UTC
- SHA-256 fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`

The certificate is installed into the API image's operating-system trust store
and supplied to Node.js, node-postgres, and Prisma through explicit TLS trust
configuration. Hostname verification remains enabled with `sslmode=verify-full`.
Never replace this with `NODE_TLS_REJECT_UNAUTHORIZED=0` or
`rejectUnauthorized: false`.
