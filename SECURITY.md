# Security Policy

RyanAI accepts vulnerability reports for the application, API, workflow services, MCP service, deployment configuration, and dependency supply chain.

## Supported versions

Security fixes are made against the latest code on the `main` branch. There are currently no numbered, supported release lines; releases should be treated as unsupported unless explicitly documented otherwise.

| Version | Support status |
| --- | --- |
| Latest `main` | Security fixes are reviewed here |
| Published releases | Support status is stated in the release notes |
| Older commits and unmaintained forks | Not guaranteed |

## Reporting a vulnerability

**Please do not report exploitable vulnerabilities in public issues or pull requests.** Use GitHub's private vulnerability reporting feature for this repository, if available. If private reporting is unavailable, contact the repository maintainers through the private contact method listed in the GitHub organization profile. Include a safe reproduction, affected commit or version, impact, and suggested mitigation where possible.

Do not include live credentials, customer data, production tokens, or destructive proof-of-concept payloads in a report.

## What to expect

- The maintainers will acknowledge a report as soon as reasonably possible.
- We will attempt to reproduce and assess its severity and scope.
- We will coordinate a fix and disclosure timeline with the reporter where practical.
- A report may be declined if it cannot be reproduced, is out of scope, or describes expected behavior; where possible, the reason will be explained.

Please allow maintainers reasonable time to investigate before public disclosure. Do not test against systems or accounts you do not own or have explicit permission to assess.

## Deployment security

- Keep secrets in a secret manager or protected environment variables; never commit `.env` files.
- Rotate credentials immediately if they may have been exposed.
- Restrict database, Redis, API and MCP access to trusted networks.
- Keep optional integrations and production write/sync operations disabled until explicitly reviewed.
