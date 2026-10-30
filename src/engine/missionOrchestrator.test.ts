import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  planObjective: vi.fn(),
  executeTasks: vi.fn(),
  runSecurityAuditor: vi.fn(),
  saveCheckpoint: vi.fn(),
  getLatestCheckpoint: vi.fn(),
}));
vi.mock('./dispatcher', () => ({
  RyanAIDispatcher: {
    planObjective: mocks.planObjective,
    executeTasks: mocks.executeTasks,
  },
}));
vi.mock('./agentWorkers', () => ({
  RyanAIAgentWorkers: { runSecurityAuditor: mocks.runSecurityAuditor },
}));
vi.mock('./checkpointer', () => ({
  RyanAICheckpointer: { saveCheckpoint: mocks.saveCheckpoint, getLatestCheckpoint: mocks.getLatestCheckpoint },
}));

import { RyanAIMissionOrchestrator } from './missionOrchestrator';

const plan = {
  plan: 'safe plan',
  tasks: [{ id: 'task-1', title: 'Analyze', targetBrain: 'nvidia' as const, payload: 'Analyze architecture.' }],
};
const results = [{
  id: 'task-1', title: 'Analyze', brain: 'nvidia' as const, durationSeconds: '0.10', output: 'Analysis complete',
}];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.planObjective.mockResolvedValue(plan);
  mocks.executeTasks.mockResolvedValue(results);
  mocks.runSecurityAuditor.mockResolvedValue({ agentName: 'SecuritySentinel', output: 'RISK_LEVEL: LOW\nNo side effects.' });
  mocks.saveCheckpoint.mockResolvedValue(true);
  mocks.getLatestCheckpoint.mockResolvedValue(null);
});

describe('RyanAI mission security gate', () => {
  it('audits a plan before executing any tasks', async () => {
    const mission = await new RyanAIMissionOrchestrator().startMission('mission-low', 'Analyze the platform');
    expect(mission.status).toBe('COMPLETED');
    expect(mocks.runSecurityAuditor).toHaveBeenCalledOnce();
    expect(mocks.executeTasks).toHaveBeenCalledWith(plan.tasks);
    expect(mission.results).toEqual(results);
  });

  it('fails closed before security review when the task plan cannot be checkpointed', async () => {
    mocks.saveCheckpoint.mockResolvedValue(false);
    const mission = await new RyanAIMissionOrchestrator().startMission('mission-no-store', 'Analyze the platform');
    expect(mission.status).toBe('FAILED');
    expect(mocks.runSecurityAuditor).not.toHaveBeenCalled();
    expect(mocks.executeTasks).not.toHaveBeenCalled();
  });

  it('pauses when the security decision is high or ambiguous', async () => {
    mocks.runSecurityAuditor.mockResolvedValue({ agentName: 'SecuritySentinel', output: 'Potential risk found.' });
    const mission = await new RyanAIMissionOrchestrator().startMission('mission-review', 'Analyze the platform');
    expect(mission.status).toBe('PAUSED_FOR_APPROVAL');
    expect(mocks.executeTasks).not.toHaveBeenCalled();
  });

  it('does not execute a paused mission until explicit approval', async () => {
    mocks.runSecurityAuditor.mockResolvedValue({ agentName: 'SecuritySentinel', output: 'RISK_LEVEL: HIGH\nReview required.' });
    const orchestrator = new RyanAIMissionOrchestrator();
    const paused = await orchestrator.startMission('mission-approve', 'Analyze the platform');
    expect(paused.status).toBe('PAUSED_FOR_APPROVAL');
    expect(mocks.executeTasks).not.toHaveBeenCalled();
    const completed = await orchestrator.resumeMission('mission-approve', true);
    expect(completed?.status).toBe('COMPLETED');
    expect(mocks.executeTasks).toHaveBeenCalledOnce();
  });

  it('restores a paused mission from its persisted checkpoint after process restart', async () => {
    const stored = {
      missionId: 'mission-restored',
      objective: 'Analyze the platform',
      currentPhase: 2,
      status: 'PAUSED_FOR_APPROVAL' as const,
      logs: ['Awaiting approval'],
      tasks: plan.tasks,
    };
    mocks.getLatestCheckpoint.mockResolvedValue({ step: 2, state: stored });
    const completed = await new RyanAIMissionOrchestrator().resumeMission('mission-restored', true);
    expect(completed?.status).toBe('COMPLETED');
    expect(mocks.executeTasks).toHaveBeenCalledWith(plan.tasks);
  });

  it('does not claim completion when execution fails', async () => {
    mocks.executeTasks.mockRejectedValue(new Error('Qwen unavailable'));
    const mission = await new RyanAIMissionOrchestrator().startMission('mission-fail', 'Analyze the platform');
    expect(mission.status).toBe('FAILED');
    expect(mission.logs.join('\n')).toContain('Qwen unavailable');
  });
});
