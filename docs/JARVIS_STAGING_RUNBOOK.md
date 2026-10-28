# Jarvis staging smoke runbook

This runbook describes how to verify the RyanAI ↔ Jarvis bridge in staging. It does not enable production sync or claim a successful handshake before the workflow has actually passed.

## Required configuration

Add these as **GitHub Actions repository or environment secrets**; never commit values to the repository:

| Secret | Purpose |
|---|---|
| `JARVIS_STAGING_BASE_URL` | HTTPS origin of the Jarvis staging service |
| `JARVIS_STAGING_API_TOKEN` | Bearer token for RyanAI's outbound requests to Jarvis |
| `RYANAI_STAGING_API_BASE_URL` | HTTPS origin of the RyanAI staging API |
| `JARVIS_STAGING_INGRESS_TOKEN` | Separate bearer token Jarvis uses when calling RyanAI's patch-ingress route |

Configure the RyanAI **staging service** with `JARVIS_PATCH_INGRESS_ENABLED=true` and `JARVIS_INGRESS_TOKEN` equal to `JARVIS_STAGING_INGRESS_TOKEN`. Keep this token distinct from `JARVIS_API_TOKEN`. The ingress route returns 404 when disabled, 503 when enabled without a token, and 401 for invalid credentials.

The workflow sets `JARVIS_SYNC_ENABLED=true` only inside its own runner and keeps `JARVIS_ALLOW_PRODUCTION_SYNC=false`. Production publishing must not be enabled for this test.

## Run the smoke test

1. Open **Actions → Jarvis Staging Bridge Smoke** in the RyanAI repository.
2. Select **Run workflow** on `main`.
3. First run with both optional actions disabled. This verifies that the runner can install the locked dependencies, reach Jarvis's health endpoint with its bearer token, and authenticate to the RyanAI ingress route.
4. After the baseline succeeds, optionally enable **Publish staging stack manifest** to send non-secret staging metadata to Jarvis.
5. Optionally enable **Submit harmless test candidate** to queue a clearly labelled comment-only candidate for `docs/JARVIS_STAGING_SMOKE.md` in Jarvis. That option submits a candidate for review; it does not apply it to RyanAI or deploy anything.

## Expected results

- Outbound health check reports `reachable: true` with a successful HTTP status from Jarvis.
- Inbound authentication check receives HTTP 400 for the intentionally empty JSON body. That response is expected only **after** the route accepts the bearer token and validates the body; it means the request was rejected before patch processing.
- HTTP 401 means the ingress token does not match; 404 means the ingress route is disabled or the URL is wrong; 503 means the ingress token is not configured; 5xx indicates a server or deployment problem.
- When optional actions are selected, the workflow must show the Jarvis submission receipts for stack metadata and/or the harmless test candidate.

## Evidence and limitations

A passing smoke run is evidence of an authenticated staging HTTP round trip for the endpoints it exercised. It does not by itself prove that a patch was merged, a commit was created, a production service was deployed, or every Jarvis capability is integrated. Save the Actions run URL in the release/verification notes. Do not paste tokens into logs or PR comments.
