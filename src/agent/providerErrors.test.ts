import { describe, expect, it } from 'vitest';
import { summarizeProviderError } from './providerErrors.js';

describe('summarizeProviderError', () => {
  it('never returns raw provider messages or embedded credential values', () => {
    const secret = 'nvapi-example-secret-value';
    const result = summarizeProviderError({
      status: 401,
      message: 'invalid api key ' + secret,
    });
    expect(result).toContain('HTTP 401');
    expect(result).not.toContain(secret);
    expect(result).not.toContain('invalid api key');
  });

  it('classifies rate limits, provider outages, and timeouts without response bodies', () => {
    expect(summarizeProviderError({ response: { status: 429 }, message: 'token=secret' }))
      .toBe('Provider rate limit reached (HTTP 429).');
    expect(summarizeProviderError({ status: 503, data: { key: 'secret' } }))
      .toBe('Provider service is unavailable (HTTP 503).');
    expect(summarizeProviderError({ name: 'TimeoutError', message: 'secret' }))
      .toBe('Provider request timed out.');
  });

  it('allows only a small explicit set of network error codes', () => {
    expect(summarizeProviderError({ code: 'ECONNREFUSED', message: 'secret' }))
      .toBe('Provider network request failed (ECONNREFUSED). Check endpoint reachability.');
    expect(summarizeProviderError({ code: 'SOME_PRIVATE_PROVIDER_CODE', message: 'secret' }))
      .toBe('Provider request failed. Detailed provider response omitted to protect credentials.');
  });

  it('handles unknown and non-object errors without echoing their contents', () => {
    expect(summarizeProviderError('sk-live-secret')).toBe(
      'Provider request failed. Detailed provider response omitted to protect credentials.',
    );
  });
});
