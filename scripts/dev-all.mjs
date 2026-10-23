#!/usr/bin/env node
/**
 * scripts/dev-all.mjs - Start all development services
 */
import { spawn } from 'node:child_process';

const services = [
  { name: 'API Server', cmd: 'npm', args: ['run', 'dev:api'] },
  { name: 'Web UI', cmd: 'npm', args: ['run', 'dev:web'] },
  { name: 'MCP Server', cmd: 'npm', args: ['run', 'dev:mcp'] },
];

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('Start the development services with `npm run dev` so the npm executable can be resolved.');
  process.exit(1);
}

console.log('🚀 Starting all dev services...\n');

const processes = new Map();
let shuttingDown = false;

function stopServices(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n📴 Shutting down development services...');
  for (const child of processes.values()) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
  process.exitCode = exitCode;
}

for (const service of services) {
  const child = spawn(process.execPath, [npmCli, ...service.args], { stdio: 'inherit' });
  processes.set(service.name, child);

  child.once('spawn', () => console.log(`✓ Started ${service.name}`));
  child.once('error', (error) => {
    console.error(`❌ ${service.name} failed to start: ${error.message}`);
    stopServices(1);
  });
  child.once('exit', (code, signal) => {
    if (!shuttingDown && (code !== 0 || signal)) {
      console.error(`❌ ${service.name} exited${signal ? ` after ${signal}` : ` with code ${code}`}.`);
      stopServices(code ?? 1);
    }
  });
}

process.once('SIGINT', () => stopServices());
process.once('SIGTERM', () => stopServices());
