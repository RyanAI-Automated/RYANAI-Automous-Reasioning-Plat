import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAlertConfig } from './config.js';
import { createAlertRunner, type AlertDeps } from './runner.js';

const HOUR = 3_600_000;
const reply = (status: number, body?: unknown) => ({ ok: status < 400, status, json: async () => body });

let clock = 0;
let healthStatus = 200;
let githubStatus = 200;
let githubRuns: unknown[] = [];
let open: { id: string; summary: string }[] = [];
const notify = vi.fn();
const listOpenActions = vi.fn();

const fetcher = (async (url: string) => {
  if (url.startsWith('https://api.github.com/')) {
    return reply(githubStatus, { check_runs: githubRuns });
  }
  return reply(healthStatus);
}) as unknown as typeof fetch;

function runnerFor(env: Record<string, string>) {
  const config = parseAlertConfig({
    ALERT_FAILURES_BEFORE_ALERT: '2',
    ALERT_REMINDER_HOURS: '1',
    ALERT_WATCH_APPROVALS: 'false',
    SLACK_WEBHOOK_URL: 'https://hooks.example/abc',
    ...env,
  });
  const deps: AlertDeps = { fetcher, notify, listOpenActions, now: () => clock };
  return createAlertRunner(config, deps);
}

const messages = () => notify.mock.calls.map((call) => call[0] as string);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  clock = 0;
  healthStatus = 200;
  githubStatus = 200;
  githubRuns = [];
  open = [];
  notify.mockReset();
  notify.mockResolvedValue(true);
  listOpenActions.mockReset();
  listOpenActions.mockImplementation(async () => open);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe('health checks', () => {
  const env = { ALERT_HEALTH_URLS: 'https://svc.example/health?token=secret' };

  it('alerts once after two failures, reminds after an hour, and reports recovery', async () => {
    const runner = runnerFor(env);
    healthStatus = 503;

    await runner.runCycle(); // first failure: quiet
    expect(notify).toHaveBeenCalledTimes(0);

    clock += 5 * 60_000;
    await runner.runCycle(); // second failure: down
    clock += 5 * 60_000;
    await runner.runCycle(); // still down: quiet
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain('DOWN: Health check https://svc.example/health');
    expect(messages()[0]).toContain('HTTP 503');

    clock += HOUR;
    await runner.runCycle();
    expect(messages()).toHaveLength(2);
    expect(messages()[1].startsWith('STILL DOWN')).toBe(true);

    healthStatus = 200;
    await runner.runCycle();
    await runner.runCycle();
    expect(messages()).toHaveLength(3);
    expect(messages()[2].startsWith('RECOVERED')).toBe(true);
  });

  it('keeps the query string, and so any token in it, out of the alert', async () => {
    const runner = runnerFor(env);
    healthStatus = 503;
    await runner.runCycle();
    await runner.runCycle();
    expect(messages()[0]).not.toContain('secret');
    expect(messages()[0]).not.toContain('token=');
  });

  it('sends a lost alert again at the next check', async () => {
    const runner = runnerFor(env);
    healthStatus = 503;
    notify.mockResolvedValueOnce(false);
    await runner.runCycle();
    await runner.runCycle(); // "down" is raised, but nobody got it
    await runner.runCycle(); // so it is raised again
    expect(messages().map((text) => text.split(':')[0])).toEqual(['DOWN', 'DOWN']);
    await runner.runCycle();
    expect(messages()).toHaveLength(2); // and now it is quiet
  });

  it('counts a request that throws as a failure', async () => {
    const throwing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const runner = createAlertRunner(parseAlertConfig({ ...env, ALERT_WATCH_APPROVALS: 'false' }), {
      fetcher: throwing,
      notify,
      listOpenActions,
      now: () => clock,
    });
    await runner.runCycle();
    await runner.runCycle();
    expect(messages()[0]).toContain('ECONNREFUSED');
  });
});

describe('CI checks', () => {
  const env = { ALERT_GITHUB_REPOS: 'octo/app' };

  it('alerts when the CI of the branch stays red', async () => {
    const runner = runnerFor(env);
    githubRuns = [{ name: 'build', status: 'completed', conclusion: 'failure' }];
    await runner.runCycle();
    await runner.runCycle();
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain('CI on octo/app (main)');
    expect(messages()[0]).toContain('1 check failed: build.');
  });

  it('does not alert when GitHub cannot answer', async () => {
    const runner = runnerFor(env);
    githubStatus = 500;
    for (let i = 0; i < 4; i += 1) await runner.runCycle();
    expect(notify).toHaveBeenCalledTimes(0);
    expect(warn).toHaveBeenCalledTimes(4);
  });
});

describe('approval watch', () => {
  const env = { ALERT_WATCH_APPROVALS: 'true' };

  it('announces each waiting action once', async () => {
    const runner = runnerFor(env);
    open = [{ id: 'a1', summary: 'Email to ada@example.com: "Hello"' }];
    await runner.runCycle();
    await runner.runCycle();
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain('APPROVAL NEEDED: 1 action wait');
    expect(messages()[0]).toContain('Email to ada@example.com: "Hello"');

    open = [...open, { id: 'a2', summary: 'Voice call to +1234567890: "Hi"' }];
    await runner.runCycle();
    expect(messages()).toHaveLength(2);
    expect(messages()[1]).toContain('1 action wait');
    expect(messages()[1]).not.toContain('ada@example.com');
  });

  it('announces again when the first message did not get through', async () => {
    const runner = runnerFor(env);
    open = [{ id: 'a1', summary: 'Email to ada@example.com: "Hello"' }];
    notify.mockResolvedValueOnce(false);
    await runner.runCycle();
    await runner.runCycle();
    expect(messages()).toHaveLength(2);
    await runner.runCycle();
    expect(messages()).toHaveLength(2);
  });

  it('says nothing when the queue is empty, and survives a read error', async () => {
    const runner = runnerFor(env);
    await runner.runCycle();
    expect(notify).toHaveBeenCalledTimes(0);
    listOpenActions.mockRejectedValue(new Error('database is down'));
    await runner.runCycle();
    expect(notify).toHaveBeenCalledTimes(0);
  });

  it('does not read the queue when the approval watch is off', async () => {
    const runner = runnerFor({ ALERT_WATCH_APPROVALS: 'false' });
    await runner.runCycle();
    expect(listOpenActions).toHaveBeenCalledTimes(0);
  });
});
