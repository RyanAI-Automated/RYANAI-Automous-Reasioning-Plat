import { afterEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import { queryStackOverflow } from './stackoverflow.js';

afterEach(() => vi.restoreAllMocks());

describe('Stack Overflow query errors', () => {
  it.each([
    [{ message: 'Provider rejected query' }, 'Provider rejected query'],
    [{ message: 42 }, 'Request failed'],
    [null, 'Request failed'],
    ['invalid response', 'Request failed'],
  ])('narrows the provider response %j', async (data, expected) => {
    const error = Object.assign(new AxiosError('Request failed'), { response: { data } });
    vi.spyOn(axios, 'post').mockRejectedValue(error);
    expect(await queryStackOverflow({ query: 'synthetic test' })).toEqual({
      success: false, data: null, error: expected,
    });
  });

  it.each([
    [new Error('Local failure'), 'Local failure'],
    [null, 'null'],
    ['', 'Unknown network error'],
  ])('handles non-Axios failures %j', async (error, expected) => {
    vi.spyOn(axios, 'post').mockRejectedValue(error);
    expect((await queryStackOverflow({ query: 'synthetic test' })).error).toBe(expected);
  });
});
