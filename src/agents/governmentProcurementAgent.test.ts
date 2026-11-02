import { describe, expect, it, vi } from 'vitest';
import { runGovernmentProcurementAgent, ZA_GOVERNMENT_PROCUREMENT_SKILL } from './governmentProcurementAgent.js';

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

describe('South African public procurement agent: input and endpoint guards', () => {
  const okHost = 'https://ocds-api.etenders.gov.za/api/releases';
  const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: 200, ...init });

  it('requires a non-empty query', async () => {
    await expect(runGovernmentProcurementAgent({ query: '   ' })).rejects.toThrow(/query is required/);
  });

  it('truncates very long queries to 300 characters', async () => {
    const result = await runGovernmentProcurementAgent({ query: 'x'.repeat(400) });
    expect(result.query).toHaveLength(300);
  });

  it('rejects HTTPS hosts that are not on the National Treasury allowlist', async () => {
    const fetcher = vi.fn();
    await expect(runGovernmentProcurementAgent({ query: 'q', apiUrl: 'https://example.com/api' }, fetcher as unknown as typeof fetch)).rejects.toThrow(/HTTPS/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects URLs with embedded credentials', async () => {
    const fetcher = vi.fn();
    await expect(runGovernmentProcurementAgent({ query: 'q', apiUrl: 'https://user:pass@ocds-api.etenders.gov.za/api' }, fetcher as unknown as typeof fetch)).rejects.toThrow(/HTTPS/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends a read-only GET that refuses redirects', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ releases: [] }));
    await runGovernmentProcurementAgent({ query: 'q', apiUrl: okHost }, fetcher as unknown as typeof fetch);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error' });
  });
});

describe('South African public procurement agent: response handling', () => {
  const apiUrl = 'https://ocds-api.etenders.gov.za/api/releases';
  const run = (response: Response, limit?: number) =>
    runGovernmentProcurementAgent({ query: 'q', apiUrl, limit }, vi.fn().mockResolvedValue(response) as unknown as typeof fetch);
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ocid: `ocds-${i}` }));

  it('fails on non-2xx responses', async () => {
    await expect(run(new Response('nope', { status: 503 }))).rejects.toThrow(/HTTP 503/);
  });

  it('rejects responses whose declared size is over 2 MB', async () => {
    await expect(run(new Response('{}', { status: 200, headers: { 'content-length': '2000001' } }))).rejects.toThrow(/2 MB/);
  });

  it('rejects bodies over 2 MB even without a content-length header', async () => {
    await expect(run(new Response('a'.repeat(2_000_001), { status: 200 }))).rejects.toThrow(/2 MB/);
  });

  it('rejects non-JSON content', async () => {
    await expect(run(new Response('<html></html>', { status: 200 }))).rejects.toThrow(/non-JSON/);
  });

  it('defaults to 25 records and caps requests at 100', async () => {
    const body = JSON.stringify({ releases: many(150) });
    expect((await run(new Response(body, { status: 200 }))).records).toHaveLength(25);
    expect((await run(new Response(body, { status: 200 }), 500)).records).toHaveLength(100);
  });

  it('accepts a top-level JSON array and wraps other objects as one record', async () => {
    expect((await run(new Response(JSON.stringify(many(3)), { status: 200 }))).records).toHaveLength(3);
    expect((await run(new Response(JSON.stringify({ ocid: 'single' }), { status: 200 }))).records).toEqual([{ ocid: 'single' }]);
  });
});

describe('South African procurement skill definition', () => {
  it('is public-data-only and forbids bid submission and credential harvesting', () => {
    expect(ZA_GOVERNMENT_PROCUREMENT_SKILL.mode).toBe('public-data-only');
    expect(ZA_GOVERNMENT_PROCUREMENT_SKILL.forbidden).toEqual(expect.arrayContaining(['automated-bid-submission', 'credential-harvesting']));
    expect(Object.isFrozen(ZA_GOVERNMENT_PROCUREMENT_SKILL)).toBe(true);
  });
});
