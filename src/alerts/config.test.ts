import { describe, expect, it } from 'vitest';
import { configuredChannels, parseAlertConfig } from './config.js';

describe('parseAlertConfig', () => {
  it('uses safe defaults when nothing is set', () => {
    expect(parseAlertConfig({})).toEqual({
      intervalMs: 300_000,
      failuresBeforeAlert: 2,
      reminderMs: 21_600_000,
      healthUrls: [],
      githubRepos: [],
      githubBranch: 'main',
      githubToken: undefined,
      watchApprovals: true,
      slackWebhookUrl: undefined,
      email: undefined,
      whatsappTo: undefined,
    });
  });

  it('reads lists, numbers, and channels from the environment', () => {
    const config = parseAlertConfig({
      ALERT_HEALTH_URLS: 'https://a.example/health, http://b.example/ready',
      ALERT_GITHUB_REPOS: 'octo/app,octo/site',
      ALERT_GITHUB_BRANCH: 'release/1.0',
      ALERT_GITHUB_TOKEN: 'token-test',
      ALERT_INTERVAL_SECONDS: '120',
      ALERT_FAILURES_BEFORE_ALERT: '3',
      ALERT_REMINDER_HOURS: '12',
      ALERT_WATCH_APPROVALS: 'false',
      SLACK_WEBHOOK_URL: 'https://hooks.example/abc',
      ADMIN_EMAIL: 'owner@example.com',
      ALERT_WHATSAPP_TO: '+1234567890',
    });
    expect(config.healthUrls).toEqual(['https://a.example/health', 'http://b.example/ready']);
    expect(config.githubRepos).toEqual(['octo/app', 'octo/site']);
    expect(config.githubBranch).toBe('release/1.0');
    expect(config.intervalMs).toBe(120_000);
    expect(config.failuresBeforeAlert).toBe(3);
    expect(config.reminderMs).toBe(43_200_000);
    expect(config.watchApprovals).toBe(false);
    expect(configuredChannels(config)).toEqual(['slack', 'email', 'whatsapp']);
  });

  it('refuses values that cannot work, with a message that names the setting', () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ ALERT_HEALTH_URLS: 'not a url' }, /ALERT_HEALTH_URLS/],
      [{ ALERT_HEALTH_URLS: 'ftp://host/file' }, /http or https/],
      [{ ALERT_GITHUB_REPOS: 'justonename' }, /owner\/repo/],
      [{ ALERT_GITHUB_REPOS: 'a/b/c' }, /owner\/repo/],
      [{ ALERT_GITHUB_BRANCH: 'a b' }, /branch/],
      [{ ALERT_INTERVAL_SECONDS: '10' }, /ALERT_INTERVAL_SECONDS/],
      [{ ALERT_INTERVAL_SECONDS: 'soon' }, /ALERT_INTERVAL_SECONDS/],
      [{ ALERT_FAILURES_BEFORE_ALERT: '0' }, /ALERT_FAILURES_BEFORE_ALERT/],
      [{ ALERT_REMINDER_HOURS: '1000' }, /ALERT_REMINDER_HOURS/],
      [{ SLACK_WEBHOOK_URL: 'http://hooks.example/abc' }, /https/],
    ];
    for (const [env, message] of cases) {
      expect(() => parseAlertConfig(env)).toThrow(message);
    }
  });

  it('counts only the channels that have a destination', () => {
    expect(configuredChannels(parseAlertConfig({}))).toEqual([]);
    expect(configuredChannels(parseAlertConfig({ ADMIN_EMAIL: 'owner@example.com' }))).toEqual(['email']);
  });
});
