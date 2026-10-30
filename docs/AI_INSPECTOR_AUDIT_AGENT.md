# RyanAI AI Inspector & Audit Agent

## Purpose
A repository-owned release-quality sentinel that produces repeatable, evidence-based audits.

## Run
```sh
npm run audit:inspector
npm run audit:inspector -- --write
```

The read-only first release checks pinned npm lifecycle-script policy against the lockfile, font import placement, repository npm configuration, Puppeteer references, and built JavaScript chunk sizes.

## Authority and safeguards
- Never approve or execute dependency lifecycle scripts automatically.
- Never decrypt, print, edit, or rotate Vercel environment variables or production secrets.
- Never deploy, promote, merge, or push to production.
- Never edit source as an unattended remediation.
- Treat empty runtime-log results as inconclusive, not proof of healthy integrations.
- Propose changes with evidence and require human approval for policy, secret, and deployment actions.

## Extension path
The deterministic audit is the trust baseline. A later AI reasoning layer may summarize findings through RyanAI's server-side authenticated API and publish GitHub Checks. Model output must cite deterministic evidence; it must not execute remediations. Do not introduce browser-exposed `VITE_*` model credentials.

## Release gates
Run this audit on pull requests alongside typecheck, lint, unit tests, frontend build, backend build, and targeted integration checks. Block releases on critical/high findings unless a human-approved exception is documented. Verify Vercel deployment state and GitHub status contexts independently.
