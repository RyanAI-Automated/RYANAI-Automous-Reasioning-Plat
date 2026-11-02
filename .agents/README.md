# RyanAI Engineering Skills

This repository adopts the composable workflow model from [Matt Pocock's Skills For Real Engineers](https://github.com/mattpocock/skills) (MIT; see `LICENSES/MATT-POCOCK-SKILLS-MIT.txt`) and applies RyanAI's own authority, security and release rules.

## Invocation model

- **User-invoked workflows** are explicit commands initiated by the user (for example, grill-with-docs, to-spec, to-tickets, implement, handoff). They orchestrate work but do not grant additional permissions.
- **Model-invoked disciplines** are applied automatically when relevant (TDD, diagnosis, architecture, prototype, code review, research, domain modelling).
- The agent conducts one focused alignment interview for a feature. It does not repeatedly interrupt during routine execution. It checks back only for newly discovered material decisions, scope changes, or high-risk actions.

## Skill inventory (27 upstream skills)

### Engineering — user-invoked
1. ask-matt
2. grill-with-docs
3. triage
4. improve-codebase-architecture
5. setup-matt-pocock-skills
6. to-spec
7. to-tickets
8. implement
9. implement-spec
10. wayfinder
11. retro

### Engineering — model-invoked
12. prototype
13. diagnosing-bugs
14. research
15. tdd
16. domain-modeling
17. codebase-design
18. code-review
19. pr
20. wizard

### Productivity — user-invoked
21. grill-me
22. handoff
23. teach
24. to-questionnaire
25. wait-what

### Productivity — model-invoked
26. grilling
27. writing-for-agents

Upstream skill source and updates: https://github.com/mattpocock/skills. The initial RyanAI integration implements the core operating contract in `AGENTS.md` and the focused skill guides alongside this catalog. Do not silently install duplicate copies into multiple agent-specific directories; keep one canonical project-level skill source and add thin adapters for Codex/Claude/Copilot only when required.

## RyanAI-specific adaptations
- Jarvis is the engineering orchestrator; RyanAI controls permissions, execution and approval.
- Agent workspaces are isolated and resource-bounded.
- No autonomous merge, deployment, production migration, secret change or paid resource creation.
- Use Supabase preview branches only when the project has branching enabled and approved credentials are available. Never fall back to the production database for CI.
- Prefer deterministic tests and sanitized fixtures. Production data is not copied into agent/PR branches by default.
