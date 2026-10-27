import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkGithub, checkHttp, summarizeCheckRuns } from './checks.js';

const fetcher = vi.fn();
const asFetch = () => fetcher as unknown as typeof fetch;
const reply = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => fetcher.mockReset());

describe('checkHttp', () => {
  it('passes for a success status', async () => {
    fetcher.mockResolvedValue(reply(200));
    expect(await checkHttp('https://a.example/health', asFetch())).toEqual({ status: 'ok' });
  });

  it('fails with the status for an error answer', async () => {
    fetcher.mockResolvedValue(reply(503));
    expect(await checkHttp('https://a.example/health', asFetch())).toEqual({
      status: 'fail',
      detail: 'The server answered HTTP 503.',
    });
  });

  it('fails with the reason when the request throws', async () => {
    fetcher.mockRejectedValue(new Error('getaddrinfo ENOTFOUND a.example'));
    const result = await checkHttp('https://a.example/health', asFetch());
    expect(result).toEqual({ status: 'fail', detail: 'The request failed: getaddrinfo ENOTFOUND a.example' });
  });

  it('says that there was no answer when the request times out', async () => {
    fetcher.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }));
    const result = await checkHttp('https://a.example/health', asFetch(), 10_000);
    expect(result).toEqual({ status: 'fail', detail: 'No answer within 10 seconds.' });
  });
});

describe('summarizeCheckRuns', () => {
  it('passes when no finished run failed', () => {
    expect(
      summarizeCheckRuns([
        { name: 'build', status: 'completed', conclusion: 'success' },
        { name: 'lint', status: 'completed', conclusion: 'skipped' },
        { name: 'deploy', status: 'completed', conclusion: 'cancelled' },
        { name: 'test', status: 'in_progress', conclusion: null },
      ]),
    ).toEqual({ status: 'ok' });
  });

  it('fails with the names of the failed checks, each name once', () => {
    expect(
      summarizeCheckRuns([
        { name: 'build', status: 'completed', conclusion: 'failure' },
        { name: 'build', status: 'completed', conclusion: 'failure' },
        { name: 'test', status: 'completed', conclusion: 'timed_out' },
        { name: 'lint', status: 'completed', conclusion: 'success' },
      ]),
    ).toEqual({ status: 'fail', detail: '2 checks failed: build, test.' });
  });

  it('shows five names at most', () => {
    const runs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => ({
      name,
      status: 'completed',
      conclusion: 'failure',
    }));
    expect(summarizeCheckRuns(runs)).toEqual({
      status: 'fail',
      detail: '7 checks failed: a, b, c, d, e, and 2 more.',
    });
  });
});

describe('checkGithub', () => {
  it('asks for the check runs of the branch and sends the token when there is one', async () => {
    fetcher.mockResolvedValue(reply(200, { check_runs: [] }));
    await checkGithub('octo/app', 'release/1.0', 'token-test', asFetch());
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/octo/app/commits/release%2F1.0/check-runs?per_page=100');
    expect(init.headers.Authorization).toBe('Bearer token-test');
  });

  it('sends no Authorization header without a token', async () => {
    fetcher.mockResolvedValue(reply(200, { check_runs: [] }));
    await checkGithub('octo/app', 'main', undefined, asFetch());
    expect('Authorization' in fetcher.mock.calls[0][1].headers).toBe(false);
  });

  it('reports a red CI as a failure', async () => {
    fetcher.mockResolvedValue(
      reply(200, { check_runs: [{ name: 'build', status: 'completed', conclusion: 'failure' }] }),
    );
    expect(await checkGithub('octo/app', 'main', undefined, asFetch())).toEqual({
      status: 'fail',
      detail: '1 check failed: build.',
    });
  });

  it('skips, and does not fail, when GitHub cannot answer', async () => {
    fetcher.mockResolvedValueOnce(reply(403));
    expect((await checkGithub('octo/app', 'main', undefined, asFetch())).status).toBe('skip');
    fetcher.mockResolvedValueOnce(reply(200, { unexpected: true }));
    expect((await checkGithub('octo/app', 'main', undefined, asFetch())).status).toBe('skip');
    fetcher.mockRejectedValueOnce(new Error('socket hang up'));
    expect((await checkGithub('octo/app', 'main', undefined, asFetch())).status).toBe('skip');
  });
});
