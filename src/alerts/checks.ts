import type { CheckResult } from './monitor.js';

const HTTP_TIMEOUT_MS = 10_000;
const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
const MAX_NAMES = 5;

/** Check that a URL answers with a success status within 10 seconds. */
export async function checkHttp(
  url: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<CheckResult> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? { status: 'ok' } : { status: 'fail', detail: `The server answered HTTP ${response.status}.` };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    const detail = timedOut
      ? `No answer within ${Math.round(timeoutMs / 1000)} seconds.`
      : `The request failed: ${error instanceof Error ? error.message : String(error)}`;
    return { status: 'fail', detail };
  }
}

interface CheckRun {
  name?: unknown;
  status?: unknown;
  conclusion?: unknown;
}

/** Turn the check runs of one commit into a result. Runs that are not finished do not count. */
export function summarizeCheckRuns(runs: CheckRun[]): CheckResult {
  const names = new Set<string>();
  for (const run of runs) {
    if (run.status === 'completed' && typeof run.conclusion === 'string' && FAILED_CONCLUSIONS.has(run.conclusion)) {
      names.add(typeof run.name === 'string' ? run.name : 'unnamed check');
    }
  }
  if (names.size === 0) return { status: 'ok' };
  const shown = [...names].slice(0, MAX_NAMES).join(', ');
  const more = names.size > MAX_NAMES ? `, and ${names.size - MAX_NAMES} more` : '';
  return { status: 'fail', detail: `${names.size} check${names.size === 1 ? '' : 's'} failed: ${shown}${more}.` };
}

/**
 * Check the CI of the latest commit on a branch. A GitHub error is a "skip", not
 * a failure: it says that the check could not run, not that CI is red.
 * shortcut: this reads the first 100 check runs only, so a failed run after
 * the 100th is not seen. Follow the Link header when a repo gets that many.
 */
export async function checkGithub(
  repo: string,
  branch: string,
  token: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<CheckResult> {
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}/check-runs?per_page=100`;
  try {
    const response = await fetcher(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ryanai-alerts',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { status: 'skip', detail: `GitHub answered HTTP ${response.status} for ${repo}.` };
    }
    const body = (await response.json()) as { check_runs?: CheckRun[] };
    if (!Array.isArray(body.check_runs)) {
      return { status: 'skip', detail: `GitHub sent an answer for ${repo} that has no check runs.` };
    }
    return summarizeCheckRuns(body.check_runs);
  } catch (error) {
    return { status: 'skip', detail: `Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}` };
  }
}
