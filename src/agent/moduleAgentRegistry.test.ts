import { describe, expect, it } from 'vitest';
import {
  findModuleAgentForTask,
  getModuleAgentForModule,
  getModuleAgentProfile,
  RYANAI_MODULE_AGENT_COUNT,
  RYANAI_MODULE_AGENT_ROSTER,
} from './moduleAgentRegistry.js';

describe('RyanAI 12-module agent workforce', () => {
  it('defines exactly twelve uniquely identified module agents', () => {
    expect(RYANAI_MODULE_AGENT_ROSTER).toHaveLength(RYANAI_MODULE_AGENT_COUNT);
    expect(new Set(RYANAI_MODULE_AGENT_ROSTER.map((agent) => agent.id)).size).toBe(RYANAI_MODULE_AGENT_COUNT);
    expect(new Set(RYANAI_MODULE_AGENT_ROSTER.map((agent) => agent.moduleId)).size).toBe(RYANAI_MODULE_AGENT_COUNT);
  });

  it('gives each agent a module, responsibility, task types, and measurable KPIs', () => {
    for (const agent of RYANAI_MODULE_AGENT_ROSTER) {
      expect(agent.moduleId.trim()).not.toBe('');
      expect(agent.moduleName.trim()).not.toBe('');
      expect(agent.responsibility.trim()).not.toBe('');
      expect(agent.taskTypes.length).toBeGreaterThan(0);
      expect(agent.kpis.length).toBeGreaterThan(0);
      expect(agent.allowedActions.length).toBeGreaterThan(0);
    }
  });

  it('does not grant privileged or external side-effect capabilities', () => {
    const forbidden = new Set([
      'secrets.read',
      'secrets.write',
      'production.change',
      'production.migrate',
      'deployment.execute',
      'external-message.send',
      'external-call.place',
      'brokerage.order.place',
      'pull-request.merge',
      'agent.permission.grant',
    ]);

    for (const agent of RYANAI_MODULE_AGENT_ROSTER) {
      for (const action of agent.allowedActions) {
        expect(forbidden.has(action)).toBe(false);
      }
    }
  });

  it('resolves module, agent, and task ownership without guessing', () => {
    expect(getModuleAgentProfile('quant-module-agent')?.moduleId).toBe('quant');
    expect(getModuleAgentForModule('memory')?.id).toBe('memory-module-agent');
    expect(findModuleAgentForTask('comms-readiness-audit')?.moduleId).toBe('comms');
    expect(getModuleAgentProfile('unknown-agent')).toBeNull();
    expect(getModuleAgentForModule('unknown-module')).toBeNull();
    expect(findModuleAgentForTask('unknown-task')).toBeNull();
  });

  it('keeps module ownership unique and task types unambiguous', () => {
    const taskTypes = RYANAI_MODULE_AGENT_ROSTER.flatMap((agent) => agent.taskTypes);
    expect(new Set(taskTypes).size).toBe(taskTypes.length);
  });
});
