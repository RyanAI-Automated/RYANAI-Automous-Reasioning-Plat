import { afterEach, describe, expect, it, vi } from 'vitest';
import { PipelineOrchestrator } from './pipelineOrchestrator.js';

const { runCommand } = vi.hoisted(() => ({ runCommand: vi.fn() }));

vi.mock('child_process', async () => {
  const { promisify } = await import('node:util');
  return { exec: Object.assign(vi.fn(), { [promisify.custom]: runCommand }) };
});

vi.mock('../services/dispatchService', () => ({
  DispatchService: class {
    sendWhatsAppPipelineUpdate = vi.fn().mockResolvedValue(undefined);
    sendPipelineEmailReport = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../services/githubShipper', () => ({ GitHubShipper: class {} }));

afterEach(() => vi.clearAllMocks());

describe('pipeline compilation failures', () => {
  it.each<[unknown, string]>([
    [Object.assign(new Error('Compilation failed'), { stdout: 'TypeScript diagnostic' }), 'TypeScript diagnostic'],
    [Object.assign(new Error('Compilation failed'), { stdout: 42 }), 'Compilation failed'],
    [Object.assign(new Error('Compilation failed'), { stdout: '' }), 'Compilation failed'],
    [null, 'null'],
    ['command unavailable', 'command unavailable'],
  ])('reports a safe error for %j', async (error, expected) => {
    runCommand.mockRejectedValue(error);
    const result = await new PipelineOrchestrator().runPipeline({
      projectName: 'synthetic', 
      branch: 'test', 
      commitMessage: 'test',
      filesToShip: [], 
      author: 'test', 
      autoShip: false, 
      transcendStrict: true,
    });
    expect(result.overallStatus).toBe('FAILED');
    expect(result.phases[1]).toMatchObject({ phase: 2, status: 'FAILED', error: expected });
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});
