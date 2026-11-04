import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const SUPPORTED_AGENTS = new Set(['claude', 'codex', 'copilot', 'cursor', 'gemini', 'opencode', 'muse', 'vibe', 'antigravity']);
const MAX_PROMPT_CHARS = 32_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS = 200;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const REQUIRED_SANDBOX_CAPABILITIES = Object.freeze({
  filesystemIsolation: true,
  workspaceMountOnly: true,
  resourceLimits: true,
  networkPolicy: 'deny-by-default',
  credentialScope: 'agent-only',
});

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function safeEnvironment(source) {
  const allowed = ['LANG', 'LC_ALL', 'CI'];
  const result = {};
  for (const key of allowed) {
    if (typeof source[key] === 'string' && source[key].length > 0) result[key] = source[key];
  }
  return result;
}

function validDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function validCommitSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
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
      // Ignore non-JSON output; raw agent output is never copied into RyanAI logs.
    }
  }
  return events;
}

function assertSandboxRunner(runner) {
  if (!runner || typeof runner.run !== 'function' || !runner.capabilities) {
    throw new Error('A configured isolated sandbox runner is required; direct host execution is disabled.');
  }
  for (const [key, expected] of Object.entries(REQUIRED_SANDBOX_CAPABILITIES)) {
    if (runner.capabilities[key] !== expected) {
      throw new Error('Sandbox runner is missing required isolation capability: ' + key);
    }
  }
}

function assertApprovalBinding(approval, task) {
  if (!approval || approval.approved !== true ||
      approval.taskId !== task.taskId ||
      approval.approvalId !== task.approvalId ||
      approval.planHash !== task.planHash ||
      approval.baseCommitSha !== task.baseCommitSha ||
      approval.proposedDiffHash !== task.proposedDiffHash ||
      typeof approval.approverId !== 'string' ||
      typeof approval.authorId !== 'string' ||
      approval.approverId === approval.authorId) {
    throw new Error('No valid independent workbench approval matches this exact task, plan, base commit and proposed diff.');
  }
}

/**
 * Runs GenAIcode only after RyanAI's trusted workbench authorizer confirms the exact
 * persisted approval binding, and only through a separately configured isolated runner.
 * The adapter never treats a caller-supplied boolean as authorization and never runs
 * a coding agent directly on the API host.
 */
export async function runGenAICodeTask(options, dependencies = {}) {
  const {
    taskId, approvalId, planHash, baseCommitSha, proposedDiffHash,
    agent, prompt, workspaceRoot, workspacePath,
    timeoutMs = DEFAULT_TIMEOUT_MS, signal, env = process.env,
  } = options ?? {};

  if (typeof dependencies.authorizeTask !== 'function') {
    throw new Error('RyanAI workbench authorization service is required.');
  }
  const runner = dependencies.sandboxRunner;
  assertSandboxRunner(runner);

  if (typeof taskId !== 'string' || !taskId.trim() ||
      typeof approvalId !== 'string' || !approvalId.trim() ||
      !validDigest(planHash) || !validCommitSha(baseCommitSha) || !validDigest(proposedDiffHash)) {
    throw new Error('Task, approval and valid SHA-256 plan/base/diff bindings are required.');
  }
  if (!SUPPORTED_AGENTS.has(agent)) throw new Error('Unsupported coding agent.');
  if (typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > MAX_PROMPT_CHARS) {
    throw new Error('Prompt must be non-empty and no longer than 32000 characters.');
  }
  if (typeof workspaceRoot !== 'string' || typeof workspacePath !== 'string') {
    throw new Error('An approved workspace root and workspace path are required.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error('Timeout must be between 1000 and 1800000 milliseconds.');
  }
  if (signal?.aborted) throw new Error('Engineering task was cancelled before launch.');

  const task = { taskId, approvalId, planHash, baseCommitSha, proposedDiffHash };
  const approval = await dependencies.authorizeTask(task);
  assertApprovalBinding(approval, task);

  const root = await realpath(workspaceRoot);
  const cwd = await realpath(workspacePath);
  if (!isWithinRoot(root, cwd) || !(await stat(cwd)).isDirectory()) {
    throw new Error('Workspace path must resolve to a directory inside the approved workspace root.');
  }

  const binary = process.env.RYANAI_GENAI_CODE_BIN || 'genaicode';
  if (typeof binary !== 'string' || binary.trim().length === 0 || binary.includes('\0')) {
    throw new Error('A valid GenAIcode executable name is required in trusted server configuration.');
  }

  const args = ['run', '--json', '-a', agent, '-C', cwd, '-'];
  const child = await runner.run({
    command: binary,
    args,
    cwd,
    workspaceRoot: root,
    env: safeEnvironment(env),
    signal,
    timeoutMs,
    limits: Object.freeze({ maxPromptChars: MAX_PROMPT_CHARS, maxOutputBytes: MAX_OUTPUT_BYTES, maxEvents: MAX_EVENTS }),
    networkPolicy: 'deny-by-default',
    credentialScope: 'agent-only',
  });

  if (!child || !child.stdout || !child.stderr || !child.stdin || typeof child.once !== 'function') {
    throw new Error('Isolated runner returned an invalid process handle.');
  }

  return await new Promise((resolve, reject) => {
    let stdout = '';
    let outputBytes = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      fn(value);
    };
    const stop = () => {
      try { child.kill('SIGTERM'); } catch { /* runner may have already stopped the process */ }
    };
    const abort = () => {
      stop();
      finish(reject, new Error('Engineering task was cancelled.'));
    };
    const timer = setTimeout(() => {
      stop();
      finish(reject, new Error('GenAIcode task exceeded its time limit.'));
    }, timeoutMs);

    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', (error) => finish(reject, new Error('Unable to start GenAIcode in the isolated runner: ' + error.message)));
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > MAX_OUTPUT_BYTES) {
        stop();
        finish(reject, new Error('GenAIcode output exceeded the 2 MiB safety limit.'));
        return;
      }
      stdout += text;
    });
    child.stderr.on('data', () => {});
    child.once('close', (code) => finish(resolve, {
      status: code === 0 ? 'completed' : 'failed',
      exitCode: Number.isInteger(code) ? code : null,
      events: parseEvents(stdout),
      verification: 'not-run',
      approvalId,
      taskId,
    }));
    try {
      child.stdin.end(prompt);
    } catch {
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
  directHostExecution: false,
  independentWorkbenchApprovalRequired: true,
  filesystemIsolationRequired: true,
  networkPolicy: 'deny-by-default',
  credentialScope: 'agent-only',
  verificationRequiredOutsideAdapter: true,
});
