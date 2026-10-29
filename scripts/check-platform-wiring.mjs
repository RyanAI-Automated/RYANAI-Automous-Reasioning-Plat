#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const fail = (message) => errors.push(message);
const readText = (file) => readFileSync(path.join(root, file), 'utf8');
const readJson = (file) => JSON.parse(readText(file));

let packageJson;
let routes;
let tauriConfig;
try {
  packageJson = readJson('package.json');
  routes = readJson('app/routes.json');
  tauriConfig = readJson('src-tauri/tauri.conf.json');
} catch (error) {
  console.error('Platform wiring check could not read a required manifest:', error);
  process.exit(1);
}

const scripts = packageJson.scripts || {};
for (const name of ['dev:api:desktop', 'dev:web:desktop', 'dev:desktop:services', 'dev:desktop', 'build:desktop']) {
  if (typeof scripts[name] !== 'string' || !scripts[name].trim()) {
    fail(`package.json is missing the ${name} script`);
  }
}

if (scripts['dev:desktop:services'] !== 'node scripts/dev-desktop.mjs') {
  fail('dev:desktop:services must launch scripts/dev-desktop.mjs');
}
if (scripts['dev:desktop'] !== 'tauri dev') {
  fail('dev:desktop must launch the Tauri development runtime');
}
if (!scripts['build:desktop']?.includes('tauri build')) {
  fail('build:desktop must invoke the Tauri build command');
}

const apiPort = scripts['dev:api:desktop']?.match(/\bPORT=(\d+)/)?.[1];
const webPort = scripts['dev:web:desktop']?.match(/\bVITE_PORT=(\d+)/)?.[1];
const devUrl = new URL(tauriConfig.build?.devUrl || 'http://invalid');
if (apiPort !== '3002') fail('Desktop API script must listen on port 3002');
if (webPort !== '1422') fail('Desktop web script must listen on port 1422');
if (devUrl.port !== webPort) fail('Tauri devUrl port must match VITE_PORT');
if (tauriConfig.build?.beforeDevCommand !== 'npm run dev:desktop:services') {
  fail('Tauri beforeDevCommand must start the desktop services script');
}
if (tauriConfig.build?.beforeBuildCommand !== 'npm run build') {
  fail('Tauri beforeBuildCommand must build the Vite frontend');
}
if (tauriConfig.build?.frontendDist !== '../dist') {
  fail('Tauri frontendDist must point at the Vite dist output');
}

const desktopRunner = readText('scripts/dev-desktop.mjs');
for (const name of ['dev:api:desktop', 'dev:web:desktop']) {
  if (!desktopRunner.includes(`npm run ${name}`)) {
    fail(`scripts/dev-desktop.mjs does not launch ${name}`);
  }
}
if (!desktopRunner.includes("MCP_PORT: '8767'")) {
  fail('Desktop MCP service must use port 8767');
}

// The CLI exposes a second Fastify entry point; keep its browser boundary secure.
const legacyServer = readText('src/server/index.ts');
if (!legacyServer.includes("import fastifyCors from '@fastify/cors'")) {
  fail('Legacy CLI server must use the Fastify CORS plugin');
}
if (!legacyServer.includes('process.env.CORS_ORIGINS')) {
  fail('Legacy CLI server must read the configured CORS origin allowlist');
}
if (!legacyServer.includes('allowedCorsOrigins.has(origin)')) {
  fail('Legacy CLI server must reject origins outside the explicit allowlist');
}
if (legacyServer.includes("reply.header('Access-Control-Allow-Origin', '*')")) {
  fail('Legacy CLI server must not allow every browser origin');
}

// HTML entry-point metadata and script safety are checked by scripts/check-index-html.mjs.
if (!readText('src/main.tsx').includes("import App from './App'")) {
  fail('src/main.tsx must mount src/App.tsx');
}

const tsconfig = readJson('tsconfig.app.json');
for (const file of ['app/page.tsx', 'store/useLogStore.ts']) {
  if (!tsconfig.include?.includes(file)) {
    fail(`tsconfig.app.json must explicitly include ${file} for the composite TypeScript project`);
  }
}

const app = readText('src/App.tsx');
if (!app.includes("import appManifest from '../app/routes.json'")) {
  fail('src/App.tsx must use app/routes.json as the route manifest');
}
if (!app.includes("import DashboardPage from '@/pages/Dashboard'")) {
  fail('src/App.tsx must import the focused system dashboard');
}
if (!app.includes("import CommandCenter from '@/pages/CommandCenter.tsx'")) {
  fail('src/App.tsx must import the workspace command center');
}
if (!app.includes("import { AgentControlPanel } from '@/components/AgentControlPanel'")) {
  fail('Desktop cockpit must import AgentControlPanel');
}
for (const id of ['dashboard', 'cockpit', 'workspace']) {
  if (!routes.routes?.some((route) => route.id === id)) {
    fail(`app/routes.json is missing the ${id} route`);
  }
}
if (!app.includes("{route === 'dashboard' && <DashboardPage />}")) {
  fail('Dashboard route must render the focused DashboardPage');
}
if (!app.includes("(route === 'workspace' || isAuthRoute)")) {
  fail('Workspace route must remain connected to the authenticated CommandCenter');
}
if (!app.includes('<CommandCenter')) {
  fail('Workspace route does not render CommandCenter');
}
if (!app.includes('{isTauri() && <AgentControlPanel />}')) {
  fail('AgentControlPanel must be limited to the native Tauri runtime');
}

const bridge = readText('src/services/tauriBridge.ts');
const commands = readText('src-tauri/src/commands.rs');
const registration = readText('src-tauri/src/lib.rs');
const invokeNames = [...bridge.matchAll(/invoke(?:<[^>]+>)?\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
for (const name of invokeNames) {
  if (!new RegExp(`fn\\s+${name}\\s*\\(`).test(commands)) {
    fail(`TauriBridge invokes ${name}, but src-tauri/src/commands.rs has no matching function`);
  }
  if (!registration.includes(name)) {
    fail(`Tauri command ${name} is not registered in src-tauri/src/lib.rs`);
  }
}
if (!bridge.includes('executeAgentReasoning')) {
  fail('TauriBridge browser fallback is not connected to the shared reasoning API');
}

if (errors.length) {
  console.error(errors.map((message) => `ERROR ${message}`).join('\n'));
  process.exit(1);
}

console.log('PASS app, src, desktop scripts, Tauri config and IPC wiring');
