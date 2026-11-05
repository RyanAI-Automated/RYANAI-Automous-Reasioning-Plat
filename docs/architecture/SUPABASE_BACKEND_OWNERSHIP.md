# RyanAI Supabase Backend Ownership Map

**Status:** Baseline inventory for the Supabase Backend Consolidation workstream  
**Inspected base commit:** d1b851ade9231c523db945b7bb63192740007552  
**Decision:** Supabase is the primary managed backend. Do not introduce another general-purpose database or CRUD API layer without a documented technical requirement.

## Target platform ownership

| Platform | Owns | Must not become |
|---|---|---|
| Supabase | PostgreSQL, pgvector, Auth, PostgREST/Data API, RLS, Storage, Realtime, suitable Edge Functions | A replacement for durable worker processes or agent orchestration |
| Render | Static frontend delivery | A second authoritative backend or database |
| Railway | Persistent LangGraph/agent workers, MCP services, inference runtimes and background jobs where actually deployed | A duplicate CRUD API or duplicate database |
| Vercel | Optional serverless execution for bounded workloads with a demonstrated need | A mandatory second backend layer |

## Existing module and data ownership

| RyanAI module / capability | Current repository evidence | Target owner | Disposition |
|---|---|---|---|
| User identity and sessions | src/server/routes/auth.ts verifies Supabase bearer tokens with auth.getUser(); src/hooks/useAuth.ts and src/lib/supabase.ts use Supabase Auth | Supabase Auth | Standardize all browser/mobile/API identity on Supabase Auth. Keep RyanAI role/owner authorization in trusted server code and claims, not user-editable metadata. |
| Profiles | profiles table and owner-scoped RLS policy | Supabase Data API + RLS | Direct authenticated CRUD where the UI needs it. |
| Conversations | conversations table; frontend already calls Supabase directly in Command Center | Supabase Data API + RLS | Reuse the existing direct Data API pattern; remove only proven duplicate route handlers after caller inventory. |
| Chat messages | messages table; frontend already calls Supabase directly | Supabase Data API + RLS | Direct user-owned CRUD; preserve conversation ownership policy and message-trigger invariants. |
| Memory Vault | src/server/routes/memory.ts exposes authenticated list/search/create/update/delete via Prisma; src/components/MemoryVault.tsx calls those endpoints | Supabase Data API + RLS for user-facing CRUD; direct PostgreSQL remains for reasoning/agent memory tools | First low-risk CRUD consolidation candidate. Preserve search semantics, account-scoped cursor pagination, validation, response states and cross-account isolation before retiring routes. |
| Reasoning memory context and memory tools | src/agent/memoryContext.ts, src/agent/tools/memoryTools.ts, MemoryEntry Prisma model | RyanAI server/worker + Supabase PostgreSQL | Keep server-side access where reasoning needs trusted retrieval, embeddings or transactional orchestration. Do not route model tools through a browser credential. |
| Agent runs, instances, handoffs, approvals | Prisma models and src/server/routes/agentOperations.ts, approval routes | RyanAI API/worker + Supabase PostgreSQL | Keep domain APIs and transactional state changes server-side. |
| LangGraph checkpointing | Repository dependency @langchain/langgraph-checkpoint-postgres and PostgresSaver | Persistent worker + Supabase PostgreSQL | Direct PostgreSQL connection is required for checkpoint adapter behavior. Validate pooler compatibility and durability; do not replace with generic REST CRUD. |
| Communications | Communication tables, authenticated routes, provider callbacks, attachment scanning and signed Supabase Storage uploads | RyanAI server + Supabase DB/Storage | Keep dispatch approvals, provider callbacks, idempotency and scanning in trusted server code. Keep human approval before outbound dispatch. |
| Audiobook Studio | Dedicated audiobook Prisma schema and worker script; optional AUDIOBOOK_DATABASE_URL | Evaluate Supabase schema consolidation; worker remains persistent | Do not add or pay for another database by default. Preserve schema isolation and job durability; retain Neon only with documented technical evidence. |
| Quant Lab | Quant routes, paper proposals, risk and reconciliation workflows | RyanAI server/worker + Supabase PostgreSQL | Keep isolated execution and paper-trading safety logic server-side. No brokerage integration. |
| GitHub integration | OAuth callback/state and integration routes | RyanAI server + Supabase persistence where appropriate | Keep OAuth secrets and token exchange server-side; do not expose credentials through Data API. |
| Attachments | Supabase Storage signed upload/download and scanning workflows | Supabase Storage + RyanAI scanner | Keep private buckets, signed intents, malware quarantine and authorization checks. |
| Realtime | Supabase Realtime capability available; no active supabase.channel usage found in initial code search | Supabase Realtime where justified | Introduce only for verified live dashboard/chat requirements; not as a substitute for durable queues. |

## CRUD duplication inventory

### Confirmed candidate: Memory Vault

The following endpoints in src/server/routes/memory.ts are CRUD-shaped and are called by src/components/MemoryVault.tsx through authenticatedFetch:

- GET /api/user/memory — account-scoped list, text/category/key search, bounded page size and keyset cursor.
- POST /api/user/memory — create an account-owned entry.
- PUT /api/user/memory/:id — update only when both entry ID and authenticated user ID match.
- DELETE /api/user/memory/:id — delete only when both entry ID and authenticated user ID match.

The live Supabase project inspection found the corresponding public.memory_entries RLS policies:
- SELECT: auth.uid() = user_id
- INSERT: auth.uid() = user_id in WITH CHECK
- UPDATE: auth.uid() = user_id in USING and WITH CHECK
- DELETE: auth.uid() = user_id

The repository's Data API grant migration also grants authenticated CRUD privileges on memory_entries. This makes direct authenticated Supabase CRUD technically viable, subject to exact behavior-preserving tests.

### Required safeguards before route retirement

1. Use the current Supabase Auth session and publishable key only. Never ship service-role credentials to a browser.
2. RLS must remain the authoritative row ownership boundary; client-supplied user_id is never trusted.
3. Preserve the existing 2,000-character content limit, 50-character category limit, default category, search limit, page size range and invalid-cursor behavior.
4. Preserve descending created_at / ID ordering and null timestamp pagination behavior.
5. Escape PostgREST filter syntax and LIKE wildcard characters in search input; do not interpolate raw user search text into a filter expression.
6. Preserve create/update/delete success and error states and prevent stale page cursors after mutations.
7. Add tests for anonymous access, two-user isolation, CRUD, search escaping, pagination, invalid cursors, and RLS denial.
8. Verify that reasoning and agent memory retrieval continue to see the same records.
9. Only then deprecate/remove the matching Fastify routes and their tests.

**Implementation status:** Memory Vault's React UI now uses a dedicated Supabase Data API adapter for list/search/create/update/delete. The existing Fastify routes and their tests remain in place as compatibility endpoints; they have not been retired. Client queries rely on the verified Supabase Auth identity and database RLS rather than trusting a client-supplied owner filter. Unit tests cover query construction, search escaping, account identity matching, ordering and cursor behavior. A transaction-scoped two-user pgTAP suite is added at `supabase/tests/memory_entries_rls.test.sql`; it must be executed with the repository's local Supabase test stack before claiming end-to-end RLS isolation. No hosted database policy or schema was changed.

## Direct PostgreSQL connection requirements

Direct PostgreSQL remains justified for:
- LangGraph PostgresSaver checkpoint reads/writes.
- Prisma transactions and relations spanning multiple RyanAI domain records.
- Agent queue claiming, locking, retries and atomic state transitions.
- Background workers and long-running processing.
- Controlled migration tooling and schema validation.
- Database-native operations not supported by the Data API.

Use the Supabase connection string and pooler mode appropriate to each runtime. Do not guess hostnames or credentials. Do not disable TLS verification. Render currently reports PostgreSQL password authentication failure (28P01); resolve using the exact Supabase Dashboard connection details before considering the API operational.

## Authentication authority

Supabase Auth is the canonical user identity provider for:
- Browser frontend
- Mobile client
- RyanAI API bearer-token verification
- Authenticated Data API requests protected by RLS

RyanAI server-side authorization remains responsible for:
- Admin and owner privileges
- Tool permissions and execution scopes
- Human approval requirements
- Service-to-service authentication
- Provider webhooks and OAuth token handling

The current API auth middleware verifies tokens with Supabase auth.getUser() and derives role from app_metadata. The legacy local password endpoints return HTTP 410. Do not remove compatibility code until all callers and integrations have been checked.

## Hosting responsibility and current evidence

- Render ryanai-web: static frontend service is configured.
- Render ryanai-api: existing API service is configured, but its last observed startup failed PostgreSQL authentication and did not start the API listener.
- Railway: the inspected RyanAI project/service inventory did not establish separate deployed LangGraph, MCP or inference services. This is an evidence gap, not proof those workloads do not exist elsewhere.
- Vercel: keep optional; introduce no new dependency unless a bounded serverless use case is documented.

Before changing hosting responsibilities, inventory every actual deployment, service, environment, persistent volume, queue and worker entrypoint. Do not move or stop workloads based on inferred topology.

## Known Beta Readiness blockers

- Render API database connection failed with PostgreSQL 28P01; /health and agent checkpoint readiness were not verified.
- Railway persistent workload topology is incomplete in the connected project inventory.
- Supabase security advisor findings require review: SECURITY DEFINER function grants/context, anonymous-role policies, leaked-password protection, MFA options and RLS performance.
- Supabase table/policy presence is not proof of authenticated end-to-end behavior.
- The current Render deployment commit differs from current GitHub main; no deployment is authorized by this workstream.

## Acceptance gates for the consolidation workstream

- [ ] Complete route-to-module-to-table-to-auth-boundary inventory.
- [ ] Memory Vault UI uses the Supabase Data API adapter; unit tests cover validation, search-filter escaping, authenticated identity matching, stable ordering and cursor behavior.
- [ ] Execute `supabase/tests/memory_entries_rls.test.sql` against the local Supabase test stack and retain the pgTAP output proving two-user RLS isolation.
- [ ] Verify actual authenticated browser CRUD and reasoning-memory continuity; only then deprecate/remove the retained Fastify Memory Vault routes and their tests.
- [ ] Conversation/profile CRUD ownership is documented and duplicate API handlers are removed only after caller proof.
- [ ] Browser, mobile and API user identity consistently resolve through Supabase Auth.
- [ ] LangGraph checkpoints and agent workers persist through Supabase PostgreSQL using a verified connection mode.
- [ ] MCP and inference deployment topology is verified without breaking persistence.
- [ ] No duplicate database remains without a documented technical requirement.
- [ ] CI and security checks pass on the exact PR head; no queued, pending, skipped or cancelled check is counted as passing.
- [ ] Human review is approved before merge.

## Change and release boundaries

This workstream does not authorize production deployment, production database migrations, secret changes, paid upgrades, production infrastructure changes, automatic merge or review bypass. Changes remain on a separate branch and must pass exact-head CI/security checks and human review.
