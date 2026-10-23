import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import process from 'node:process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const root = process.cwd();
const children = [];
let shuttingDown = false;

function clearPorts() {
  if (process.platform !== 'win32') return;
  for (const port of [3001, 1420, 1421, 8766]) {
    try {
      const output = execFileSync('powershell.exe', [
        '-NoProfile', '-Command',
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`,
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const value of output.split(/\s+/).filter(Boolean)) {
        const pid = Number(value);
        if (pid && pid !== process.pid) {
          execFileSync('powershell.exe', [
            '-NoProfile', '-Command',
            `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`,
          ], { stdio: 'ignore' });
        }
      }
    } catch {
      // Child startup reports any remaining collision.
    }
  }
}

function start(args, env) {
  const child = spawn(npm, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: true,
    windowsHide: false,
  });
  children.push(child);
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) void shutdown(code || 1);
  });
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500).unref();
}

clearPorts();
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

start(['run', 'dev:api'], {});
start(['run', 'dev:web'], { VITE_STRICT_PORT: 'true' });
start(['--prefix', 'mcp-server', 'run', 'start:http'], { MCP_PORT: '8766' });

console.log('[local] API: http://127.0.0.1:3001');
console.log('[local] Web: http://127.0.0.1:1420');
console.log('[local] MCP: http://127.0.0.1:8766');

await new Promise(() => {});
