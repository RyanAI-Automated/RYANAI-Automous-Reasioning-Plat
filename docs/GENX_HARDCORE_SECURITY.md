# Gen-X Hard Core Security

RyanAI Gen-X combines deterministic authorization with AI-assisted defensive incident triage. The deterministic policy is authoritative; model output cannot grant access or downgrade a deny decision.

## Enforced application policy

- Denies arbitrary shell/terminal execution for agents.
- Denies a maintained list of offensive tooling and command runners (including Metasploit, SQLmap, Hydra, Mimikatz, Nmap, Masscan, and related tools).
- Denies agent access to credentials, tokens, private keys, vaults, and environment files.
- Denies autonomous production deletion.
- Requires authenticated human approval for network changes and write/mutation actions.
- Allows only a small set of explicitly named read-only tools; unknown tools require approval by default.
- Applies the policy to the current LangGraph diagnostics and documentation-search tools.
- Keeps retrieved content and incident payloads untrusted; the security agent does not follow instructions contained in them.

## Malware and human-targeted threat handling

The AI analyst can summarize indicators and recommend defensive containment for malware, phishing, social engineering, impersonation, credential theft, and suspicious activity. This is analysis, not an antivirus engine or a guarantee of detection. Actual file scanning requires the separately configured ClamAV attachment scanner. Human safety incidents require appropriate human/security-team escalation; RyanAI cannot prevent physical attacks.

## Important deployment boundary

This module is an application-level policy engine. It does **not** install or enforce an operating-system firewall, eBPF network policy, endpoint protection driver, or network IDS. The AgentPA status therefore reports `eBPFPolicyEnforced: false`. Host/network enforcement requires a separately provisioned and tested firewall/EDR layer and least-privilege deployment.

The legacy shell tool is disabled and its workspace reader now resolves real paths and blocks credential-file patterns. This does not make the API a general-purpose sandbox. Do not expose arbitrary command execution to agents or users.

## Operations and validation

- Run `npm test -- src/security/genxPolicy.test.ts` and the full validation pipeline.
- Review every new tool against the Gen-X policy before registration.
- Keep production write permissions disabled for autonomous agents.
- Persist audit events to the production audit store before using this as a compliance control; this initial policy module returns structured rule IDs but does not itself provide durable SIEM storage.
- Test with two accounts and verify that blocked calls do not reach the underlying tool handler.
