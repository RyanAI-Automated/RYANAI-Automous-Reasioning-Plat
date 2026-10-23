import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import process from 'node:process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const root = process.cwd();
const children = [];
let shuttingDown = false;
let exitCode = 0;

function clearDesktopPorts() {
  if (process.platform !== 'win32') return;
  for (const port of [3002, 1422, 1423, 8767]) {
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
      // Child startup reports any collision that remains.
    }
  }
}

function start(command, env) {
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', command], {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: 'inherit',
        windowsHide: false,
      })
    : spawn('sh', ['-lc', command], {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: 'inherit',
      });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (!shuttingDown && code !== 0) {
      console.error(`[desktop] child exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`);
      void shutdown(code || 1);
    }
  });
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

clearDesktopPorts();
process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

start('npm run dev:api:desktop', {});
start('npm run dev:web:desktop', {});
start('npm --prefix mcp-server run start:http', { MCP_PORT: '8767' });

console.log('[desktop] API: http://127.0.0.1:3002');
console.log('[desktop] Web: http://127.0.0.1:1422');
console.log('[desktop] MCP: http://127.0.0.1:8767');

await new Promise(() => {});
