import { checkGithub, checkHttp } from './checks.js';
import { configuredChannels, parseAlertConfig, type AlertConfig } from './config.js';
import { describeEvent, initialState, step, type CheckResult, type CheckState } from './monitor.js';
import { notifyOwner } from './notify.js';

const FIRST_CHECK_DELAY_MS = 15_000;
const MAX_APPROVALS_SHOWN = 5;

interface Watch {
  label: string;
  run: () => Promise<CheckResult>;
}

export interface OpenAction {
  id: string;
  summary: string;
}

export interface AlertDeps {
  fetcher: typeof fetch;
  /** Send a message to the owner. Return true when at least one channel got it. */
  notify: (message: string) => Promise<boolean>;
  listOpenActions: () => Promise<OpenAction[]>;
  now: () => number;
}

/** A label for a URL without its query string, so a token in the query never reaches an alert. */
function urlLabel(url: string): string {
  const { origin, pathname } = new URL(url);
  return `${origin}${pathname}`;
}

function buildWatches(config: AlertConfig, fetcher: typeof fetch): Watch[] {
  return [
    ...config.healthUrls.map((url) => ({
      label: `Health check ${urlLabel(url)}`,
      run: () => checkHttp(url, fetcher),
    })),
    ...config.githubRepos.map((repo) => ({
      label: `CI on ${repo} (${config.githubBranch})`,
      run: () => checkGithub(repo, config.githubBranch, config.githubToken, fetcher),
    })),
  ];
}

/**
 * Build a runner that checks everything once for each call to runCycle().
 * It keeps the state of every check in memory.
 * shortcut: the state is per process. After a restart, a check that still fails
 * must fail `failuresBeforeAlert` times again before it alerts again.
 */
export function createAlertRunner(config: AlertConfig, deps: AlertDeps) {
  const watches = buildWatches(config, deps.fetcher);
  const states = new Map<string, CheckState>();
  let announced = new Set<string>();

  async function runWatch(watch: Watch) {
    let result: CheckResult;
    try {
      result = await watch.run();
    } catch (error) {
      result = { status: 'skip', detail: error instanceof Error ? error.message : String(error) };
    }
    if (result.status === 'skip') {
      console.warn(`[alerts] Skipped "${watch.label}": ${result.detail}`);
    }

    const previous = states.get(watch.label) ?? initialState;
    const { state, event } = step(previous, result, deps.now(), config);
    if (!event) {
      states.set(watch.label, state);
      return;
    }

    const detail = result.status === 'fail' ? result.detail : '';
    const delivered = await deps.notify(describeEvent(watch.label, event, detail));
    // An alert that nobody got must go out again at the next check. Count the
    // failure, but keep the old alert time, so the same event comes back.
    states.set(watch.label, delivered ? state : { ...previous, failures: state.failures });
  }

  async function runApprovalWatch() {
    const open = await deps.listOpenActions();
    const openIds = new Set(open.map((action) => action.id));
    // Forget the actions that were decided or expired, so the set does not grow.
    announced = new Set([...announced].filter((id) => openIds.has(id)));

    const fresh = open.filter((action) => !announced.has(action.id));
    if (fresh.length === 0) return;

    const lines = fresh.slice(0, MAX_APPROVALS_SHOWN).map((action) => `- ${action.summary}`);
    const more = fresh.length > MAX_APPROVALS_SHOWN ? `\n...and ${fresh.length - MAX_APPROVALS_SHOWN} more.` : '';
    const message =
      `APPROVAL NEEDED: ${fresh.length} action${fresh.length === 1 ? '' : 's'} wait for you\n` +
      `${lines.join('\n')}${more}\nReview them with GET /api/actions.`;
    if (await deps.notify(message)) {
      for (const action of fresh) announced.add(action.id);
    }
  }

  return {
    async runCycle(): Promise<void> {
      for (const watch of watches) {
        await runWatch(watch);
      }
      if (config.watchApprovals) {
        try {
          await runApprovalWatch();
        } catch (error) {
          console.warn('[alerts] Could not read the approval queue:', error instanceof Error ? error.message : error);
        }
      }
    },
  };
}

/**
 * Start the alert loop. It throws when the settings cannot work, for example
 * when no channel has a destination. Returns a function that stops the loop.
 */
export function startAlerts(config: AlertConfig = parseAlertConfig(process.env)): () => void {
  const channels = configuredChannels(config);
  if (channels.length === 0) {
    throw new Error('ALERTS_ENABLED is true, but no channel has a destination. Set SLACK_WEBHOOK_URL, ADMIN_EMAIL, or ALERT_WHATSAPP_TO.');
  }

  const runner = createAlertRunner(config, {
    fetcher: fetch,
    now: Date.now,
    notify: async (message) => {
      const outcomes = await notifyOwner(message, config);
      for (const outcome of outcomes.filter((item) => !item.ok)) {
        console.error(`[alerts] The ${outcome.channel} channel failed: ${outcome.error}`);
      }
      return outcomes.some((outcome) => outcome.ok);
    },
    listOpenActions: async () => {
      const { listOpenActions } = await import('../approvals/pendingStore.js');
      return listOpenActions();
    },
  });

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runner.runCycle();
    } catch (error) {
      console.error('[alerts] Cycle failed:', error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };

  const first = setTimeout(tick, Math.min(FIRST_CHECK_DELAY_MS, config.intervalMs));
  const timer = setInterval(tick, config.intervalMs);
  first.unref();
  timer.unref();
  console.log(
    `[alerts] Started. ${config.healthUrls.length} health URL(s), ${config.githubRepos.length} repo(s), ` +
      `approvals ${config.watchApprovals ? 'watched' : 'not watched'}. Channels: ${channels.join(', ')}. ` +
      `Every ${Math.round(config.intervalMs / 1000)} seconds.`,
  );
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
