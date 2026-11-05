# RyanAI Microsoft Engineering Intelligence Integration — assessment

**Assessment date:** 5 November 2026  
**Repository base:** `5ede9d5e3a3b7715cb924d3c4a38429b886100a0` (`main`)  
**Proposal status:** development-time evaluation only; no runtime adoption approved.

## Executive recommendation

Evaluate the Microsoft Agent Framework Python builder skill as optional guidance for future Python Agent Framework work, and document Microsoft Learn MCP as an optional, read-only documentation source for authorized coding agents.

Do not introduce the Microsoft Agent Framework SDK, provider adapters, Azure/Foundry services, or any new runtime dependency in this proposal. RyanAI's TypeScript/LangGraph orchestration remains authoritative. NVIDIA, Qwen, Logic, and Ollama remain independently managed and must not be routed through or replaced by this evaluation.

## Repository findings at the inspected base

- The root application is a TypeScript/Node.js 24.x, React/Vite application. The root manifest is `package.json`; the other Node packages are `mcp-server/package.json` and `workflows-ryanai/package.json`.
- The existing agent orchestration is implemented in TypeScript using LangGraph. The Python builder skill must not be used as a reason to port or replace that orchestration.
- `comms-orchestration/` is documented as an optional Python standard-library contract package for durable task persistence, atomic claiming, owner checks, and analyse/draft actions. It is an interface layer, not a live worker or provider-dispatch implementation.
- `quant-engine/` is a dependency-free deterministic Python research engine. Its README states Python 3.10+ and explicitly excludes broker, network, LLM, credentials, and real-order integrations. It is not an Agent Framework agent.
- Root Python examples and scripts exist, but the inspected repository evidence does not establish a current Python application built on Microsoft Agent Framework.
- Repository search did not surface a `.csproj` or `.sln`; no .NET application has been identified. Keep the .NET builder skill out of scope until a real .NET project is found.
- `AGENTS.md` and `.github/copilot-instructions.md` already require isolated workspaces, least privilege, no secret access, no self-approval, no direct main pushes, exact-head checks, and human review.

## Python Builder Skill assessment

Upstream source: [Microsoft Agent Framework Python builder skill](https://github.com/microsoft/agent-framework/tree/07b9b3fc6f896cc4a0ac86e74cb11fc4d894ca19/skills/agent-framework-builder-python)

- Reviewed upstream repository commit: `07b9b3fc6f896cc4a0ac86e74cb11fc4d894ca19`.
- Skill metadata version: `0.3`; license declared by the skill: MIT.
- The skill is development-time guidance for building, modifying, evaluating, integrating, and hosting Python applications with Microsoft Agent Framework. It is not a runtime plugin.
- Its guidance includes choosing the smallest suitable pattern (plain agent, harness, workflow, evaluation, observability, integration, or hosting), inspecting the project before changes, and validating against current APIs.
- The skill states Microsoft Agent Framework requires Python 3.11 or later. Do not apply that requirement to RyanAI's separate Python 3.10+ quant engine or change its interpreter as part of this evaluation.
- **Fit:** useful as an opt-in reference for a future, explicitly approved Python Agent Framework component. Current Python communications contracts and the quant engine do not justify adding the SDK or migrating existing logic.

### Proposed use

1. Install the skill only in an authorized development agent/client, not in the shipped application.
2. Pin and record the reviewed upstream commit; do not track `main` silently.
3. Restrict its use to a scoped Python Agent Framework task or an isolated compatibility spike.
4. Keep the existing TypeScript/LangGraph orchestration, PostgreSQL/pgvector memory, and all four existing providers unchanged.
5. Do not install Microsoft provider packages or add model credentials as part of the skill evaluation.

## Microsoft Learn MCP assessment

Official endpoint: `https://learn.microsoft.com/api/mcp` (Streamable HTTP).

Microsoft documents the public server as unauthenticated and free, with documentation-only content. Its documented tools are:

- `microsoft_docs_search`
- `microsoft_docs_fetch`
- `microsoft_code_sample_search`

The tool list is dynamic and must be discovered by the MCP client at connection time; clients must not hardcode tool schemas. This is a documentation retrieval service, not a conventional stable REST API.

### Proposed access boundary

- Configure only in an authorized developer tool/agent, never in RyanAI's production runtime.
- Permit only the Learn documentation search/fetch/code-sample tools.
- Treat returned documentation and examples as untrusted reference material; inspect and adapt before use.
- Never include secrets, environment values, private user data, or production records in documentation queries.
- Do not add Azure MCP, Foundry MCP, deployment tools, or write-capable cloud integrations under this proposal.
- If the selected coding client cannot enforce a read-only tool allowlist, do not connect it to an agent that can take consequential actions.

## Provider and architecture preservation

This proposal does not modify provider configuration, provider routing, credentials, model catalogues, runtime orchestration, memory, database schema, migrations, or deployment configuration.

NVIDIA, Qwen, Logic, and Ollama remain independently managed. No provider is implicitly enabled, substituted, or granted new access.

PostgreSQL and pgvector remain RyanAI's authoritative persistent memory foundation. Microsoft Agent Framework is not a replacement for the existing LangGraph orchestration.

## Evaluation and acceptance gates

Before any broader adoption:

1. Verify the coding client supports Agent Skills and can pin the skill snapshot to the reviewed commit.
2. Verify the client can connect to Learn MCP over Streamable HTTP and dynamically discover the three documented read tools.
3. Confirm the tool policy is read-only and the MCP server is available only to the intended development agent.
4. Run a small, isolated Python-only exercise using synthetic data; do not touch production credentials, databases, or provider routing.
5. Compare the result with existing Python tests and RyanAI engineering standards; record dependency, compatibility, and security findings.
6. Require exact-commit CI, security checks, and human review for any subsequent code PR.

A successful documentation lookup is not evidence that Agent Framework is suitable for RyanAI runtime use. A successful local exercise is not production approval.

## Non-goals

- No Microsoft Agent Framework SDK/runtime dependency.
- No Python or .NET port of the TypeScript application.
- No provider replacement, consolidation, credential sharing, or routing change.
- No Azure/Foundry resource provisioning or paid service.
- No production deployment, database migration, secret change, or permission expansion.
- No automatic agent execution, code merge, or self-approval.

## Sources

- [Microsoft Agent Framework repository and builder skills](https://github.com/microsoft/agent-framework/tree/07b9b3fc6f896cc4a0ac86e74cb11fc4d894ca19/skills)
- [Microsoft Learn MCP developer reference](https://learn.microsoft.com/en-us/training/support/mcp-developer-reference)
- [Microsoft Learn MCP best practices](https://learn.microsoft.com/en-us/training/support/mcp-best-practices)
- [Microsoft Learn MCP overview](https://learn.microsoft.com/en-us/training/support/mcp)
