export type GenXDecision = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
export type GenXAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EXECUTE' | 'NETWORK' | 'CREDENTIAL_ACCESS';

export interface GenXSecurityEvent {
  agentId: string;
  principal: string;
  toolName: string;
  action: GenXAction;
  target?: string;
  command?: string;
  environment?: 'development' | 'staging' | 'production';
}

export interface GenXPolicyResult {
  decision: GenXDecision;
  ruleId: string;
  reason: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

const BLOCKED_TOOL_NAMES = new Set([
  'execute_shell_command', 'shell', 'terminal', 'raw_exec', 'run_command',
  'metasploit', 'msfconsole', 'msfvenom', 'sqlmap', 'hydra', 'medusa',
  'john', 'hashcat', 'aircrack-ng', 'bettercap', 'ettercap', 'responder',
  'masscan', 'nmap', 'crackmapexec', 'netexec', 'impacket', 'bloodhound',
  'mimikatz', 'lazagne', 'evil-winrm', 'empire',
]);

const SAFE_READ_ONLY_TOOLS = new Set([
  'system_diagnostics', 'read_workspace_file', 'query_stackoverflow_agents',
  'security_status', 'trivy_scan', 'clamav_scan', 'dependency_audit',
]);

const SENSITIVE_TARGET = /(secret|credential|token|private.?key|password|\.env|vault)/i;
const COMMAND_CONTROL = /[;&|<>\x60\n\r]|\$\(|\$\{|\\\\|(^|\s)(sudo|su|chmod|chown|curl|wget|nc|ncat|netcat|ssh|scp|sftp|powershell|pwsh|cmd\.exe|bash|sh|python|node|perl|ruby|php|ftp|telnet|iptables|ufw|netsh|reg)(\s|$)/i;

export function evaluateGenXSecurityEvent(event: GenXSecurityEvent): GenXPolicyResult {
  const tool = event.toolName.trim().toLowerCase();
  if (!event.agentId.trim() || !event.principal.trim() || !tool) {
    return { decision: 'DENY', ruleId: 'GX-IDENTITY-001', reason: 'Agent and principal identity are mandatory.', severity: 'HIGH' };
  }
  if (event.command !== undefined || event.action === 'EXECUTE' || BLOCKED_TOOL_NAMES.has(tool)) {
    return { decision: 'DENY', ruleId: 'GX-EXEC-001', reason: 'Arbitrary command execution and offensive security tooling are disabled by Gen-X policy.', severity: 'CRITICAL' };
  }
  if (event.action === 'CREDENTIAL_ACCESS' || SENSITIVE_TARGET.test(event.target ?? '')) {
    return { decision: 'DENY', ruleId: 'GX-SECRETS-001', reason: 'Agents cannot read or export credentials, secrets, private keys, or environment files.', severity: 'CRITICAL' };
  }
  if (event.action === 'DELETE' && event.environment === 'production') {
    return { decision: 'DENY', ruleId: 'GX-PROD-DELETE-001', reason: 'Production deletion is prohibited for autonomous agents.', severity: 'CRITICAL' };
  }
  if (event.action === 'CREATE' || event.action === 'UPDATE' || event.action === 'DELETE' || event.action === 'NETWORK') {
    return { decision: 'REQUIRE_APPROVAL', ruleId: 'GX-HIL-001', reason: 'Mutating or network actions require an authenticated human approval and scoped credentials.', severity: 'HIGH' };
  }
  if (event.action === 'READ' && SAFE_READ_ONLY_TOOLS.has(tool)) {
    return { decision: 'ALLOW', ruleId: 'GX-READ-001', reason: 'Known read-only tool is allowed within its own access controls.', severity: 'LOW' };
  }
  if (event.action === 'READ' && event.target && COMMAND_CONTROL.test(event.target)) {
    return { decision: 'DENY', ruleId: 'GX-INJECTION-001', reason: 'Request contains shell-control or command-injection syntax.', severity: 'HIGH' };
  }
  return { decision: 'REQUIRE_APPROVAL', ruleId: 'GX-DEFAULT-DENY-001', reason: 'Unknown tools and actions are not trusted by default.', severity: 'MEDIUM' };
}

export function isGenXOffensiveTool(toolName: string): boolean {
  return BLOCKED_TOOL_NAMES.has(toolName.trim().toLowerCase());
}
