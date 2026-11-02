# RyanAI AI engineering tools registry

**Purpose:** turn external AI coding-tool discovery into a maintained, security-reviewed capability registry—not an unverified list of links.

## Research finding

The curated-index idea is useful because the ecosystem spans different layers: editors, coding agents, CLI harnesses, model providers, agent skills, MCP servers, sandboxes, observability and review tools. But a directory entry is only a discovery lead. It is not evidence that installation instructions, versions, compatibility, security posture or runtime behavior remain valid.

Useful discovery references (reviewed 2026-11-02):

- [AgentYard directory](https://www.agentyard.fun/) — broad categories across coding agents, skills, MCP, databases, browser automation and infrastructure.
- [ToolPassed agent directory](https://toolpassed.com/agents/) — emphasizes named maintainers/vendors, versions, release dates and re-checking on major releases or broken links.
- [mcpHQ Awesome MCP Servers](https://github.com/mcpHQ/awesome-mcp-servers) — curated, link-checked MCP catalog with structured data and periodic checks.
- [awesome-mcp](https://github.com/abordage/awesome-mcp) — automated daily discovery and ranking; useful for discovery, but automated activity ranking is not a substitute for RyanAI security review.
- [GitHub Copilot MCP documentation](https://docs.github.com/en/copilot/concepts/customizations/mcp) — demonstrates per-surface MCP configuration, scoped credentials and the risk that delegated cloud agents may call configured tools autonomously.
- [Supabase AI Tools](https://supabase.com/docs/guides/ai-tools) — official examples of coding-agent integrations through MCP, plugins and reusable skills.
- [Model Context Protocol clients documentation](https://github.com/modelcontextprotocol/docs/blob/main/clients.mdx) — client compatibility reference.

The social post names osp.fyi, but the exact original directory URL and its current contents were not independently resolved during this research pass. Do not attribute entries or quality guarantees to it until the canonical URL is confirmed.

## Registry categories

| Category | What RyanAI should track | Candidate evaluation focus |
|---|---|---|
| Editors | VS Code, Cursor, Zed and compatible IDEs | MCP/ACP support, remote workspace support, policy controls, accessibility and licensing |
| Coding agents | Codex, OpenCode, Claude Code, Qwen Code, Copilot and other agents | branch isolation, deterministic diffs, tests, human review, provider flexibility and telemetry |
| CLI and runtimes | Agent CLIs, task runners, sandboxes and background workers | resumability, process isolation, quotas, cancellation, non-interactive use and auditability |
| Code models | NVIDIA, Qwen, Logic and other evaluated code/reasoning models | live authentication, benchmark task suite, context limits, latency, cost and data handling |
| Skills and workflows | Project skills, spec/TDD/review packs and agent instruction systems | provenance, license, instruction conflicts, testability and version pinning |
| MCP servers | GitHub, Supabase, Playwright, Context7, MCPJungle and candidates | tool-level ACLs, auth model, transport, secret handling, sandboxing, supply chain and health checks |
| Verification and security | CodeQL, Trivy, TruffleHog, SBOM, test/eval and observability systems | reproducibility, coverage, false-positive handling and evidence export |

These are candidates for evaluation, not approvals or installed dependencies.

## Required registry record

Every entry must include:

- canonical project and vendor URLs; repository and immutable release/tag/commit where applicable
- category, maintainer, license and provenance
- supported OS, runtime, client/agent versions and transport/protocol versions
- installation and removal steps tested in a disposable environment
- required permissions, filesystem/network scope and tool-level allowlist
- authentication type and secret names only (never secret values)
- data sent/stored, telemetry behavior and retention disclosures
- health/compatibility probe and expected output
- last verified date, verifier, evidence link and next review date
- status: candidate, under-review, verified, degraded, deprecated or rejected
- cost class and whether any paid feature is required

## Curation and maintenance

1. Discover candidates from curated directories, official vendor catalogs, GitHub and community reports.
2. Confirm the canonical upstream project and current maintenance activity.
3. Review license, ownership, releases, dependency/supply-chain signals and security advisories.
4. Pin versions/commits; never install an unpinned `latest` into a production agent image.
5. Test setup and health checks in an isolated, disposable workspace with synthetic data and no production credentials.
6. For MCP servers, enumerate tools and classify each tool's read/write/destructive/network scope. Default deny; expose only task-required tools through MCPJungle or the approved gateway.
7. Test auth expiry, unavailable server, malformed responses, timeout, cancellation and secret redaction.
8. Re-verify on version changes, reported breakage, security advisories and a scheduled interval. A failed check marks the entry degraded; it does not silently remain verified.
9. Keep a human maintainer/owner for each verified entry. Automation may detect drift but must not autonomously grant permissions or install updates.
10. Publish a changelog and remove or deprecate abandoned or unsafe entries.

## Recommended RyanAI adoption sequence

- **First:** curate a minimal, low-cost stack around the existing GitHub and Supabase integrations, current project skills, and approved MCPJungle gateway.
- **Next:** evaluate one terminal coding agent and one editor integration in isolated sandboxes; compare the same benchmark tasks and review resulting diffs.
- **Then:** evaluate model providers independently with a fixed coding benchmark and real authentication probes. Do not infer provider readiness from directory rankings.
- **Finally:** expose verified MCP tools to agents incrementally through scoped ACLs. Keep production DB, secret management, deployment and merge operations outside autonomous agent grants.

Do not add a new editor, model, agent or MCP server solely because it appears in a curated list. Require a measurable gap, safe trial, compatibility evidence and owner approval.
