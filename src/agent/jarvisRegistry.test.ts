import { describe, expect, it } from 'vitest';
import { authorizeJarvisCapability, getJarvisAgentRegistry } from './jarvisRegistry.js';

describe('Jarvis agent registry', () => {
  it('exposes unique agents with explicit roles, capabilities and permissions', () => {
    const registry = getJarvisAgentRegistry();
    expect(new Set(registry.map((agent) => agent.id)).size).toBe(registry.length);
    expect(registry.every((agent) => agent.role && agent.capabilities.length && agent.permissions.length)).toBe(true);
  });
  it('allows only capabilities explicitly granted to an agent', () => {
    expect(authorizeJarvisCapability('repository-inspector', 'repository.inspect').allowed).toBe(true);
    expect(authorizeJarvisCapability('repository-inspector', 'patch.propose').allowed).toBe(false);
    expect(authorizeJarvisCapability('not-registered', 'repository.inspect').allowed).toBe(false);
  });
  it('denies privileged capabilities even when approval is asserted', () => {
    expect(authorizeJarvisCapability('jarvis-supervisor', 'production.change').allowed).toBe(false);
    expect(authorizeJarvisCapability('jarvis-supervisor', 'production.change', true)).toMatchObject({ allowed: false, requiresApproval: true });
    expect(authorizeJarvisCapability('jarvis-supervisor', 'secrets.read').allowed).toBe(false);
    expect(authorizeJarvisCapability('jarvis-supervisor', 'deployment.execute').allowed).toBe(false);
  });
});
