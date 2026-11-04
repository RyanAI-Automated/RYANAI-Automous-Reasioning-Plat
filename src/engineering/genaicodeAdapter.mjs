import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

const SUPPORTED_AGENTS = new Set(['claude', 'codex', 'copilot', 'cursor', 'gemini', 'opencode', 'muse', 'vibe', 'antigravity']);
const MAX_PROMPT_CHARS = 32_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS = 200;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function safeEnvironment(source) {
  const allowed = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'LANG', 'LC_ALL', 'CI'];
  const result = {};
  for (const key of allowed) {
    if (typeof source[key] === 'string' && source[key].length > 0) result[key] = source[key];
  }
  return result;
}

function sanitizeEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.type !== 'string') return null;
  const event = { type: value.type.slice(0, 48) };
  if (typeof value.text === 'string') event.text = value.text.slice(0, 4_000);
  if (typeof value.name === 'string') event.name = value.name.slice(0, 120);
  if (typeof value.status === 'string') event.status = value.status.slice(0, 48);
  if (typeof value.ok === 'boolean') event.ok = value.ok;
  if (Array.isArray(value.paths)) event.paths = value.paths.filter((item) => typeof item === 'string').slice(0, 50).map((item) => item.slice(0, 500));
  return event;
}

function parseEvents(stdout) {
  const events = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = sanitizeEvent(JSON.parse(line));
      if (event && events.length < MAX_EVENTS) events.push(event);
    } catch {
      // Ignore non-JSON output: never echo raw agent output into RyanAI logs.
    }
  }
  return events;
}

/**
 * Runs a pre-installed GenAIcode CLI inside an approved workspace.
 * This adapter intentionally does not install packages, use npx, enable auto-approval,
 * or inherit provider credentials from the RyanAI API process.
 */
export async function runGenAICodeTask(options, dependencies = {}) {
  const {
    agent,
    prompt,
    workspaceRoot,
    workspacePath,
    approved,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    binary = process.env.RYANAI_GENAI_CODE_BIN || 'genaicode',
    env = process.env,
  } = options ?? {};

  if (approved !== true) throw new Error('Explicit engineering-task approval is required.');
  if (!SUPPORTED_AGENTS.has(agent)) throw new Error('Unsupported coding agent.');
  if (typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > MAX_PROMPT_CHARS) {
    throw new Error('Prompt must be non-empty and no longer than 32000 characters.');
  }
  if (typeof workspaceRoot !== 'string' || typeof workspacePath !== 'string') {
    throw new Error('An approved workspace root and workspace path are required.');
  }
  if (typeof binary !== 'string' || binary.trim().length === 0 || binary.includes('\0')) {
    throw new Error('A valid GenAIcode executable name is required.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error('Timeout must be between 1000 and 1800000 milliseconds.');
  }
  if (signal?.aborted) throw new Error('Engineering task was cancelled before launch.');

  const root = await realpath(workspaceRoot);
  const cwd = await realpath(workspacePath);
  if (!isWithinRoot(root, cwd) || !(await stat(cwd)).isDirectory()) {
    throw new Error('Workspace path must resolve to a directory inside the approved workspace root.');
  }

  const spawn = dependencies.spawn ?? nodeSpawn;
  const args = ['run', '--json', '-a', agent, '-C', cwd, '-'];
  const child = spawn(binary, args, {
    cwd,
    env: safeEnvironment(env),
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return await new Promise((resolve, reject) => {
    let stdout = '';
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let overflow = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      fn(value);
    };
    const stop = () => {
      try { child.kill('SIGTERM'); } catch { /* process may already have exited */ }
    };
    const abort = () => {
      stop();
      finish(reject, new Error('Engineering task was cancelled.'));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
      finish(reject, new Error('GenAIcode task exceeded its time limit.'));
    }, timeoutMs);

    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', (error) => finish(reject, new Error('Unable to start the configured GenAIcode executable: ' + error.message)));
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > MAX_OUTPUT_BYTES) {
        overflow = true;
        stop();
        finish(reject, new Error('GenAIcode output exceeded the 2 MiB safety limit.'));
        return;
      }
      stdout += text;
    });
    // Deliberately drain and discard stderr: CLI diagnostics can contain sensitive paths or input.
    child.stderr.on('data', () => {});
    child.once('close', (code) => {
      if (settled) return;
      if (timedOut) return finish(reject, new Error('GenAIcode task exceeded its time limit.'));
      if (overflow) return finish(reject, new Error('GenAIcode output exceeded the 2 MiB safety limit.'));
      finish(resolve, {
        status: code === 0 ? 'completed' : 'failed',
        exitCode: Number.isInteger(code) ? code : null,
        events: parseEvents(stdout),
        verification: 'not-run',
      });
    });

    try {
      child.stdin.end(prompt);
    } catch (error) {
      stop();
      finish(reject, new Error('Unable to send the task prompt to GenAIcode.'));
    }
  });
}

export const genaicodeAdapterPolicy = Object.freeze({
  supportedAgents: [...SUPPORTED_AGENTS],
  maxPromptChars: MAX_PROMPT_CHARS,
  maxOutputBytes: MAX_OUTPUT_BYTES,
  maxTimeoutMs: MAX_TIMEOUT_MS,
  autoApproval: false,
  shell: false,
  providerCredentialsInherited: false,
  verificationRequiredOutsideAdapter: true,
});
