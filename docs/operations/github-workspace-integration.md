# RyanAI GitHub workspace integration

## Current state

The in-app GitHub connection is **not configured**. The repository can be managed through an authorized engineering integration, but that does not create an OAuth session inside the RyanAI application.

## Required implementation gates

1. Register a RyanAI GitHub App (preferred) or OAuth application under the organization that owns the official repository.
2. Define the production callback URL only after the API hostname and callback route are finalized.
3. Implement server-side OAuth state generation, one-time state validation, callback handling, code exchange and session binding to the authenticated RyanAI account.
4. Store installation or user tokens in an encrypted server-side credential store. Never put tokens in Vite variables, browser storage, URLs, logs or client responses.
5. Request least privilege. Start with repository metadata, contents read, pull-request read and Actions/checks read. Add write permissions only for a separately approved workflow that requires them.
6. Verify the connected installation/account, selected repository allowlist, permission set and API reachability server-side.
7. Add disconnect, token revocation, credential rotation and audit events.
8. Add tests for CSRF/state mismatch, expired state, wrong account, revoked installation, insufficient permissions, cross-account access and sanitized error handling.

## Activation boundary

Do not display a connected state until the server has completed and verified the OAuth/App installation handshake. Do not create or rotate credentials, change organization permissions, enable production access or deploy callback infrastructure as part of a code-only PR.

## Follow-up work

The current repository does not yet provide the complete in-app OAuth callback and encrypted token lifecycle. Those are implementation prerequisites, not configuration values that can safely be guessed.
