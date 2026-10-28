export interface AlertConfig {
  intervalMs: number;
  failuresBeforeAlert: number;
  reminderMs: number;
  healthUrls: string[];
  githubRepos: string[];
  githubBranch: string;
  githubToken?: string;
  watchApprovals: boolean;
  slackWebhookUrl?: string;
  email?: string;
  whatsappTo?: string;
}

type Env = Record<string, string | undefined>;

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9_./-]+$/;

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function list(env: Env, name: string): string[] {
  return (env[name] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function text(env: Env, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

/**
 * Read the alert settings from environment variables. It throws an error with a
 * clear message for a value that cannot work, so a typo does not turn into an
 * alert that never fires.
 */
export function parseAlertConfig(env: Env): AlertConfig {
  const healthUrls = list(env, 'ALERT_HEALTH_URLS');
  for (const url of healthUrls) {
    let protocol: string;
    try {
      protocol = new URL(url).protocol;
    } catch {
      throw new Error(`ALERT_HEALTH_URLS has a value that is not a URL: ${url}`);
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error(`ALERT_HEALTH_URLS must use http or https: ${url}`);
    }
  }

  const githubRepos = list(env, 'ALERT_GITHUB_REPOS');
  for (const repo of githubRepos) {
    if (!REPO_PATTERN.test(repo)) {
      throw new Error(`ALERT_GITHUB_REPOS needs the form owner/repo: ${repo}`);
    }
  }

  const githubBranch = text(env, 'ALERT_GITHUB_BRANCH') ?? 'main';
  if (!BRANCH_PATTERN.test(githubBranch)) {
    throw new Error(`ALERT_GITHUB_BRANCH is not a valid branch name: ${githubBranch}`);
  }

  const slackWebhookUrl = text(env, 'SLACK_WEBHOOK_URL');
  if (slackWebhookUrl && !/^https:\/\//.test(slackWebhookUrl)) {
    throw new Error('SLACK_WEBHOOK_URL must start with https://.');
  }

  return {
    intervalMs: integer(env, 'ALERT_INTERVAL_SECONDS', 300, 60, 3600) * 1000,
    failuresBeforeAlert: integer(env, 'ALERT_FAILURES_BEFORE_ALERT', 2, 1, 10),
    reminderMs: integer(env, 'ALERT_REMINDER_HOURS', 6, 1, 168) * 3_600_000,
    healthUrls,
    githubRepos,
    githubBranch,
    githubToken: text(env, 'ALERT_GITHUB_TOKEN'),
    watchApprovals: text(env, 'ALERT_WATCH_APPROVALS') !== 'false',
    slackWebhookUrl,
    email: text(env, 'ADMIN_EMAIL'),
    whatsappTo: text(env, 'ALERT_WHATSAPP_TO'),
  };
}

/** The names of the channels that have a destination. */
export function configuredChannels(config: AlertConfig): string[] {
  return [
    config.slackWebhookUrl ? 'slack' : null,
    config.email ? 'email' : null,
    config.whatsappTo ? 'whatsapp' : null,
  ].filter((name): name is string => name !== null);
}
