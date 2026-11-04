import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';

const IMAGE_PATTERN = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
const COMMAND_PATTERN = /^[a-zA-Z0-9._-]+$/;
const ENV_ALLOWLIST = new Set(['LANG', 'LC_ALL', 'CI']);

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function safeEnvironment(source) {
  const result = {};
  for (const key of ENV_ALLOWLIST) {
    if (typeof source?.[key] === 'string' && source[key].length > 0 && !/[\0\r\n]/.test(source[key])) {
      result[key] = source[key];
    }
  }
  return result;
}

function assertInput(options) {
  if (!options || typeof options !== 'object') throw new Error('Sandbox options are required.');
  if (typeof options.command !== 'string' || !COMMAND_PATTERN.test(options.command)) {
    throw new Error('Sandbox command must be a simple executable name.');
  }
  if (!Array.isArray(options.args) || options.args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new Error('Sandbox arguments must be an array of safe strings.');
  }
  if (typeof options.workspaceRoot !== 'string' || typeof options.cwd !== 'string') {
    throw new Error('An approved workspace root and working directory are required.');
  }
}

export function createContainerSandboxRunner({
  image = process.env.RYANAI_GENAI_SANDBOX_IMAGE,
  spawn = nodeSpawn,
} = {}) {
  if (typeof image !== 'string' || !IMAGE_PATTERN.test(image)) {
    throw new Error('RYANAI_GENAI_SANDBOX_IMAGE must be pinned to an immutable sha256 image digest.');
  }
  if (typeof spawn !== 'function') throw new Error('A process spawn implementation is required.');

  return Object.freeze({
    capabilities: Object.freeze({
      filesystemIsolation: true,
      workspaceMountOnly: true,
      resourceLimits: true,
      networkPolicy: 'deny-by-default',
      credentialScope: 'agent-only',
    }),
    async run(options) {
      assertInput(options);
      const root = await realpath(options.workspaceRoot);
      const cwd = await realpath(options.cwd);
      if (!isWithinRoot(root, cwd) || !(await stat(cwd)).isDirectory()) {
        throw new Error('Sandbox working directory must resolve inside the approved workspace root.');
      }
      if (cwd.includes(',') || cwd.includes('\n')) throw new Error('Workspace path contains unsupported mount characters.');

      const relative = path.relative(root, cwd).split(path.sep).join('/');
      const workdir = '/workspace';
      const containerName = 'ryanai-genai-' + randomUUID();
      const env = safeEnvironment(options.env);
      const dockerArgs = [
        'run', '--rm', '--init', '--interactive',
        '--name', containerName,
        '--network=none',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '--pids-limit=128',
        '--memory=2g',
        '--cpus=2',
        '--user=10001:10001',
        '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=256m',
        '--mount', 'type=bind,src=' + cwd + ',dst=/workspace',
        '--workdir', workdir,
        ...Object.entries(env).flatMap(([key, value]) => ['--env', key + '=' + value]),
        '--entrypoint', options.command,
        image,
        ...options.args,
      ];

      const child = spawn('docker', dockerArgs, {
        cwd: root,
        env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      if (!child || typeof child.kill !== 'function') throw new Error('Container runtime did not return a process handle.');

      const originalKill = child.kill.bind(child);
      child.kill = (signal = 'SIGTERM') => {
        try {
          const killer = spawn('docker', ['kill', containerName], {
            stdio: 'ignore',
            windowsHide: true,
            env: { PATH: process.env.PATH || '/usr/bin:/bin' },
          });
          killer?.on?.('error', () => {});
        } catch {
          // Still terminate the docker client if the daemon cannot be reached.
        }
        return originalKill(signal);
      };
      return child;
    },
  });
}

export const containerSandboxPolicy = Object.freeze({
  imageMustBeDigestPinned: true,
  network: 'none',
  rootFilesystem: 'read-only',
  workspaceMount: 'single-approved-root',
  linuxCapabilities: 'drop-all',
  noNewPrivileges: true,
  user: '10001:10001',
  memory: '2g',
  cpus: 2,
  pids: 128,
  tmpfs: '/tmp:256m,noexec,nosuid,nodev',
  hostCredentialsPassed: false,
});
