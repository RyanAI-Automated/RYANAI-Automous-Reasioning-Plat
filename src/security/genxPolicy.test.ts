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
  it('denies unknown tools by default', () => {
    expect(evaluateGenXSecurityEvent({ ...base, toolName: 'unknown_future_tool' }).decision).toBe('REQUIRE_APPROVAL');
  });
  it('allows the public procurement data tool for reads only', () => {
    const procurement = { ...base, toolName: 'za_public_procurement_data' };
    expect(evaluateGenXSecurityEvent({ ...procurement, target: 'official-public-source-discovery' }).decision).toBe('ALLOW');
    expect(evaluateGenXSecurityEvent({ ...procurement, action: 'EXECUTE' }).decision).toBe('DENY');
    expect(evaluateGenXSecurityEvent({ ...procurement, action: 'NETWORK' }).decision).toBe('REQUIRE_APPROVAL');
    expect(evaluateGenXSecurityEvent({ ...procurement, action: 'CREDENTIAL_ACCESS' }).decision).toBe('DENY');
    expect(evaluateGenXSecurityEvent({ ...procurement, target: 'https://ocds-api.etenders.gov.za/vault' }).decision).toBe('DENY');
  });
});
