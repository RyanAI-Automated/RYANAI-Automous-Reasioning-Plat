import { describe, expect, it, vi } from 'vitest';

vi.mock('@langchain/openai', () => ({ ChatOpenAI: class {} }));
vi.mock('@langchain/langgraph/prebuilt', () => ({ createReactAgent: () => ({}) }));
vi.mock('./tools/whatsappTool.js', () => ({ sendWhatsAppTool: {} }));

import { verifyComplianceTool } from './subAgents.js';

describe('verify_compliance', () => {
  it('never reports a deployment as compliant while no checks are connected', async () => {
    const result = JSON.parse(await verifyComplianceTool.invoke({ deploymentId: '#402' }));
    expect(result.status).toBe('NOT_VERIFIED');
    expect(result.status).not.toBe('COMPLIANT');
    expect(result.framework).toBe('SOC2');
    expect(result.checksPassed).toBeUndefined();
  });
});
