# RyanAI Model-Independent Multimodal Security Architecture

Status: Architecture proposal; implementation is gated on existing database, CI, security and branch-protection verification.

## 1. Security authority

Gen-X is the independent policy enforcement point for every model, agent, MCP tool and execution adapter. NVIDIA, Qwen, Logic, Ollama and future model providers are untrusted inference services. A model response, confidence score, tool-call proposal, retrieved document or self-reported authorization is never an authorization grant.

The deterministic policy engine is authoritative. AI-based security analysis may provide advisory classification or triage, but cannot override an ALLOW, DENY or REQUIRE_APPROVAL decision.

## 2. Request and execution path

1. Authenticate the human or service principal.
2. Resolve agent identity, tenant/workspace scope and immutable request correlation ID.
3. Classify input as untrusted. Preserve provenance and content hashes.
4. Validate and normalize input using bounded parsers and isolated scanners.
5. Apply deterministic Gen-X policy to the requested operation, tool, target, resource and environment.
6. If permitted, invoke a model through a provider-neutral adapter with least-privilege context.
7. Treat model output and proposed tool calls as untrusted data. Validate schema, arguments, destinations and resource scope.
8. Re-evaluate each proposed action through Gen-X immediately before execution.
9. Require authenticated, scoped, expiring human approval for privileged actions; bind approval to the exact action digest, target, environment and expiry.
10. Execute only through restricted tool adapters/sandboxes and record the decision and outcome.

No model adapter may call a privileged tool directly or bypass the policy gateway.

## 3. Multimodal ingestion

Images, PDFs, office documents, archives, audio, video, OCR output, transcriptions, metadata and embedded links are untrusted.

Required controls:
- Enforce upload size, decompression, page/frame, duration, pixel and parser-time limits.
- Verify file signatures and MIME types; do not trust extensions or client-provided content types.
- Reject or quarantine malformed, encrypted (unless explicitly supported), nested archive and unsupported files.
- Malware scan in an isolated, resource-limited service. Scanner unavailable or timed out means quarantine/reject for workflows requiring scanning; never silently mark clean.
- Parse/OCR/transcribe in isolated workers with no ambient credentials or unrestricted network.
- Treat OCR, captions, transcripts, QR codes, embedded instructions and extracted links as untrusted content.
- Do not automatically fetch links, execute macros, render active content or follow document instructions.
- Retain source provenance and hashes; apply retention and deletion policy.
- Pass bounded, sanitized representations to models. Do not expose secrets or unrelated user data in model context.

Prompt-injection detection is defence-in-depth, not a substitute for deterministic tool authorization.

## 4. Retrieval and memory security

Retrieved content is evidence/data, never policy or system instruction. Apply explicit source labels and trust levels. Delimit retrieved text from system policy; ignore instructions within retrieved content that attempt to alter roles, permissions, secrets, tool use or security controls.

PostgreSQL/RAG controls:
- Enforce tenant and principal scope in every query, not only in application prompts.
- Use database least-privilege roles, parameterized queries and row-level security where applicable.
- Validate provenance, source authorization, freshness and content integrity before indexing.
- Prevent untrusted content from changing trusted memory or policy records.
- Record writes, deletes, re-indexing and access to sensitive memory.
- Treat vector similarity as relevance, never as authorization.

## 5. Agent identity and permissions

Use workload identity per agent/service, scoped capabilities and short-lived credentials. Deny by default. Separate read, write, network, execution, credential and administrative capabilities.

Agents cannot grant, widen, delegate or edit their own permissions. Permission changes require a separate authenticated administrative control plane, policy validation, audit record and human approval. An agent must not approve its own request or supply its own approver identity.

## 6. Model adapter contract

Define a provider-neutral adapter interface for NVIDIA, Qwen, Logic and Ollama. The interface should normalize:
- provider/model identity and version;
- capability declarations (text, image, audio, video, structured output);
- request/response schema and size limits;
- timeout, cancellation and resource budgets;
- token/usage metadata where available;
- refusal, error and unavailable states;
- provenance and correlation IDs.

Adapters have no policy-authority methods and no direct secret or tool-execution access. Capability claims must be verified against configuration and runtime probes. Provider failure, timeout, malformed output or adapter exception must fail closed for privileged actions. Safe read-only fallback is allowed only when independently authorized.

## 7. Self-improvement and code changes

Models and agents may propose patches, tests or configuration changes but cannot merge, deploy or change security policy themselves.

Every change must:
- be isolated in a branch/worktree;
- include a threat analysis and tests;
- pass formatting, lint, typecheck, unit/integration tests and security scans;
- be reviewed by an authorized human;
- pass protected-branch checks;
- use staged deployment and rollback evidence.

Security-policy changes require dedicated review and cannot be weakened by a model-generated patch. No runtime self-modification of the active policy engine.

## 8. Failure and incident behaviour

Policy engine unavailable, identity unavailable, audit sink unavailable (for actions requiring audit), malformed request, unknown tool, scanner failure, model failure or approval service failure must not cause a permissive fallback.

For high-risk workflows, inability to write a durable audit event means do not execute. Record sanitized incident metadata where possible, stop affected tasks, revoke scoped task credentials, quarantine affected inputs and preserve evidence. Recovery requires verified health and authorized review.

## 9. Audit and observability

Emit structured, append-oriented security events containing correlation ID, timestamp, principal/agent identity, tool/action, target classification, policy version, decision/rule ID, approval reference, model/provider metadata, scanner result and execution outcome. Never log raw secrets, credentials, full sensitive documents or unredacted prompts by default.

Use access-controlled retention, integrity verification and alerting. Do not claim tamper-proof storage unless the deployed storage and controls prove it.

## 10. Verification gates

Before implementation is enabled:
- complete current database and pgvector migration evidence;
- pass CI, lint, typecheck and unit/integration suites;
- pass CodeQL, dependency, secret and container scans;
- verify main branch protection and required reviewers/checks;
- test policy-engine outage, adapter outage, scanner outage, audit-sink outage and approval-service outage;
- test prompt injection in text, OCR, PDF, image, transcript and retrieved memory;
- test cross-tenant retrieval and agent privilege escalation;
- demonstrate that model/provider failures never grant tool access;
- document rollback and incident-response exercises.

## 11. Explicit non-goals and honest status

This proposal does not claim that malware scanning, eBPF, kernel firewalling, endpoint detection, immutable audit storage, model isolation or production enforcement are currently deployed. Each capability must have a separately verified implementation and health signal before it is reported as active.

## 12. Delivery sequence

1. Complete and validate the focused Gen-X hardening PR.
2. Complete outstanding database, CI and security gates; restore verified branch protection.
3. Review and approve this architecture proposal.
4. Implement the provider-neutral adapter contract and Gen-X gateway integration.
5. Add isolated multimodal ingestion and malware scanning.
6. Add secure retrieval/memory controls and durable audit events.
7. Add agent isolation, approval binding and controlled self-improvement.
8. Run adversarial and end-to-end verification before staged activation.
