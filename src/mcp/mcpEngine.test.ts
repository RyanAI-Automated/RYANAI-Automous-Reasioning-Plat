import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RyanMcpEngine } from './mcpEngine.js';

type Handler = (request: { params: { name: string; arguments?: Record<string, unknown> } }) => Promise<{ isError?: boolean; content: Array<{ text: string; type?: string }> }>;
const { handlers, runPipeline } = vi.hoisted(() => ({
  handlers: [] as Handler[],
  runPipeline: vi.fn(),
}));
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    setRequestHandler(_schema: unknown, handler: Handler) { handlers.push(handler); }
  },
}));
vi.mock('../orchestrator/pipelineOrchestrator', () => ({
  PipelineOrchestrator: class { runPipeline = runPipeline; },
}));

beforeEach(() => {
  handlers.length = 0;
  runPipeline.mockReset();
});

describe('Gen-X MCP enforcement', () => {
  it('blocks deployment pipeline calls before orchestration', async () => {
    new RyanMcpEngine();
    const result = await handlers[1]({
      params: { name: 'execute_pipeline', arguments: { projectName: 'RyanAI', branch: 'main' } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Gen-X blocked pipeline execution');
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it('reports that kernel eBPF is not configured', async () => {
    new RyanMcpEngine();
    const result = await handlers[1]({ params: { name: 'get_system_health' } });
    const health = JSON.parse(result.content[0].text);
    expect(health.genXPolicyState).toBe('ACTIVE');
    expect(health.ebpfProbeState).toBe('NOT_CONFIGURED');
  });
});
