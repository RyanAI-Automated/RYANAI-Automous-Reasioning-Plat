import { describe, expect, it, vi } from 'vitest';
import { runGovernmentProcurementAgent } from './governmentProcurementAgent.js';

describe('South African public procurement agent', () => {
  it('discovers official public sources without credentials', async () => {
    const result = await runGovernmentProcurementAgent({ query: 'security guarding' });
    expect(result.status).toBe('SOURCE_DISCOVERY');
    expect(result.sources.some((source) => source.url === 'https://data.etenders.gov.za/')).toBe(true);
    expect(result.sources.find((source) => source.name === 'Central Supplier Database')?.access).toBe('authorised-only');
  });

  it('uses the configured National Treasury API URL when no request URL is supplied', async () => {
    vi.stubEnv('ZA_GOV_PROCUREMENT_API_URL', 'https://ocds-api.etenders.gov.za/documented/releases');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ releases: [{ ocid: 'ocds-env' }] }), { status: 200 }));
    const result = await runGovernmentProcurementAgent({ query: 'security' }, fetcher as unknown as typeof fetch);
    expect(result.status).toBe('DATA_RETRIEVED');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBeInstanceOf(URL);
    expect((fetcher.mock.calls[0][0] as URL).pathname).toBe('/documented/releases');
    vi.unstubAllEnvs();
  });

  it('rejects non-Treasury and non-HTTPS API endpoints before fetch', async () => {
    const fetcher = vi.fn();
    await expect(runGovernmentProcurementAgent({ query: 'security', apiUrl: 'http://example.com/api' }, fetcher as unknown as typeof fetch)).rejects.toThrow(/HTTPS/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retrieves bounded JSON records from the approved public host', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ releases: [{ ocid: 'ocds-test' }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await runGovernmentProcurementAgent({ query: 'security guarding', apiUrl: 'https://ocds-api.etenders.gov.za/api/releases' }, fetcher as unknown as typeof fetch);
    expect(result.status).toBe('DATA_RETRIEVED');
    expect(result.records).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
