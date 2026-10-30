import { describe, expect, it, vi } from 'vitest';
import { AgentPASovereignCore } from './agentPAScript.js';

describe('legacy AgentPA Gen-X restrictions', () => {
  it('uses operator identity as a label rather than root authorization', () => {
    expect(() => new AgentPASovereignCore('Configured Operator')).not.toThrow();
    expect(() => new AgentPASovereignCore('')).toThrow(/display label/i);
  });

  it('does not execute shell repair for diagnostic events', async () => {
    const agent = new AgentPASovereignCore('Test Operator');
    await expect(agent.diagnoseAndHeal('TS2322')).resolves.toBe(false);
  });

  it('blocks direct self-patch callbacks', () => {
    const agent = new AgentPASovereignCore('Test Operator');
    const patch = vi.fn();
    expect(() => agent.executeSelfPatch('test patch', patch)).toThrow(/Gen-X blocked/i);
    expect(patch).not.toHaveBeenCalled();
  });

  it('blocks dynamic capability registration', () => {
    const agent = new AgentPASovereignCore('Test Operator');
    expect(() => agent.integrateMasterpieceCapability('arbitrary-tool', {})).toThrow(/Gen-X blocked/i);
  });
});
