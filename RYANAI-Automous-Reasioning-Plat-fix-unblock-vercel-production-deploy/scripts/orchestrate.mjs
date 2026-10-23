#!/usr/bin/env node
import { spawn } from 'node:child_process';

const root = new URL('../', import.meta.url);
const child = spawn('docker', ['compose', 'up', '--build', '--detach', '--wait'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    child.kill(signal);
  });
}

child.on('error', (error) => {
  console.error(`Could not start Docker Compose: ${error.message}`);
  process.exitCode = 1;
});

child.on('close', async (code) => {
  if (stopping) {
    process.exitCode = code ?? 1;
    return;
  }
  if (code !== 0) {
    process.exitCode = code ?? 1;
    return;
  }

  try {
    const response = await fetch('http://localhost:3000/health', {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`API health returned HTTP ${response.status}`);
    console.log('RyanAI is ready: http://localhost:9090 (API: http://localhost:3000)');
  } catch (error) {
    console.error(`Containers started, but the API health check failed: ${error.message}`);
    process.exitCode = 1;
  }
});
