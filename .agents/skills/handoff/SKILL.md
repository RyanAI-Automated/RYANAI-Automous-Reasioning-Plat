---
name: handoff
description: Create a compact, reproducible handoff for another agent or session.
---

# Handoff

Record:
- Objective and current status (implemented / tested / CI / reviewed / merged / deployed / runtime verified).
- Repository, branch, base/head commit SHAs and PR links.
- Changed files and why each changed.
- Decisions made, unresolved questions, constraints and explicit non-goals.
- Commands run and exact outcomes; include failures and skipped checks.
- Environment prerequisites without secret values.
- Security, migration, data and rollback risks.
- The single next action and its acceptance evidence.

Do not claim work is complete merely because a commit or PR exists. Never include credentials, private keys, access tokens, raw connection strings or sensitive user data.
