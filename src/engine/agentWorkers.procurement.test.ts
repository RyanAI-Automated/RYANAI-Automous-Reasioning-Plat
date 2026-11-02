import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/brains', () => ({ secondaryBrain: {}, logicBrain: {} }));
vi.mock('./genxSecurityAgent.js', () => ({ runGenXSecurityAgent: vi.fn() }));

import { RyanAIAgentWorkers } from './agentWorkers';

describe('RyanAIAgentWorkers.runGovernmentProcurementAgent', () => {
  beforeEach(() => {
    delete process.env.ZA_GOV_PROCUREMENT_API_URL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns official source discovery when no API URL is configured', async () => {
    const result = await RyanAIAgentWorkers.runGovernmentProcurementAgent({ query: 'security guarding' });
    expect(result.status).toBe('SOURCE_DISCOVERY');
  });

  it('is blocked by Gen-X policy before any fetch when the target looks like a secret', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      RyanAIAgentWorkers.runGovernmentProcurementAgent({ query: 'q', apiUrl: 'https://ocds-api.etenders.gov.za/api/token' }),
    ).rejects.toThrow(/Gen-X blocked procurement data access \(GX-SECRETS-001\)/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
