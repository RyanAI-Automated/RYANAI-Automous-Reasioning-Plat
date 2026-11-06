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

// The legacy CLI entry point is intentionally quarantined. The supported
// Fastify launcher must own the API listener and enforce the exact CORS allowlist.
const legacyServer = readText('src/server/index.ts');
if (
  !legacyServer.includes('Unsupported legacy API entrypoint') ||
  !legacyServer.includes('throw new Error(') ||
  legacyServer.includes('Fastify(') ||
  legacyServer.includes('.listen(')
) {
  fail('Legacy CLI server must remain quarantined; only the supported launcher may listen');
}
const primaryLauncher = readText('src/server/launcher.ts');
if (
  !primaryLauncher.includes("import fastifyCors from '@fastify/cors'") ||
  !primaryLauncher.includes('process.env.CORS_ORIGINS') ||
  !primaryLauncher.includes('allowedCorsOrigins.has(origin)') ||
  primaryLauncher.includes("reply.header('Access-Control-Allow-Origin', '*')")
) {
  fail('Supported API launcher must enforce the explicit CORS origin allowlist');
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
const importsOrLazyLoads = (source, staticImport, lazyImport) =>
  source.includes(staticImport) || source.includes(lazyImport);

if (!importsOrLazyLoads(
  app,
  "import DashboardPage from '@/pages/Dashboard'",
  "lazy(() => import('@/pages/Dashboard'))",
)) {
  fail('src/App.tsx must import or lazy-load the focused system dashboard');
}
if (!importsOrLazyLoads(
  app,
  "import CommandCenter from '@/pages/CommandCenter.tsx'",
  "lazy(() => import('@/pages/CommandCenter.tsx'))",
)) {
  fail('src/App.tsx must import or lazy-load the workspace command center');
}
if (!importsOrLazyLoads(
  app,
  "import { AgentControlPanel } from '@/components/AgentControlPanel'",
  "lazy(() => import('@/components/AgentControlPanel')",
)) {
  fail('Desktop cockpit must import or lazy-load AgentControlPanel');
}
for (const id of ['dashboard', 'operator', 'admin', 'quant', 'cockpit', 'workspace']) {
  if (!routes.routes?.some((route) => route.id === id)) {
    fail(`app/routes.json is missing the ${id} route`);
  }
}
const dashboardRoute = app.match(/\{route === 'dashboard' && <DashboardPage\\b([^>]*)\\/>\\}/);
if (
  !dashboardRoute ||
  !/\\bisOwner=\\{isOwner\\}/.test(dashboardRoute[1]) ||
  !/\\bisAdmin=\\{isAdmin\\}/.test(dashboardRoute[1])
) {
  fail('Dashboard route must render the focused DashboardPage with verified role context');
}
if (!app.includes("lazy(() => import('@/pages/OperatorConsole'))") || !app.includes("{route === 'operator' && <OperatorConsole />}")) {
  fail('Operator route must lazy-load and render the durable OperatorConsole');
}
if (!app.includes("lazy(() => import('@/pages/AdminConsole'))") || !app.includes("route === 'admin' && (isAdmin ? <AdminConsole")) {
  fail('Admin route must lazy-load and render the role-gated AdminConsole');
}
if (!app.includes("(id !== 'admin' || isAdmin)")) {
  fail('Admin navigation must remain hidden for non-admin users');
}
const operatorPage = readText('src/pages/OperatorConsole.tsx');
const adminPage = readText('src/pages/AdminConsole.tsx');
if (!operatorPage.includes('/api/agent/ops/tasks')) {
  fail('Operator console is missing authenticated task history and dispatch endpoints');
}
for (const endpoint of ['/api/admin/metrics', '/api/actions', '/api/engineering/jobs']) {
  if (!adminPage.includes(endpoint)) fail('Admin console is missing a protected control-plane endpoint: ' + endpoint);
}
if (!adminPage.includes('Approve and execute') || !adminPage.includes('Approve exact plan')) {
  fail('Admin console must expose separate, explicit approval controls');
}
const commsPage = readText('src/components/CommunicationsCenter.tsx');
if (!commsPage.includes('Search messages or addresses') || !commsPage.includes('channelFilter')) {
  fail('Comms inbox must expose message search and channel filtering');
}
if (!commsPage.includes('Private Comms attachments')
  || !commsPage.includes('getCommsAttachmentStatuses')
  || !commsPage.includes("item.status !== 'clean'")
  || !commsPage.includes("attachment.status === 'clean'")
  || !commsPage.includes('status?.channels?.attachments === true')
  || !commsPage.includes('!attachmentsEnabled')) {
  fail('Comms must retain private attachment upload, scan-gated dispatch, clean-only downloads, and the server-reported attachment feature gate');
}
const audiobookPage = readText('src/pages/AudiobookStudio.tsx');
const audiobookRoutes = readText('src/server/routes/audiobookProjects.ts');
if (!audiobookPage.includes('Private audiobook library') || !audiobookPage.includes('createNewProject')) {
  fail('Audiobook Studio must expose private project selection and creation');
}
if (!audiobookRoutes.includes("take: 50")) {
  fail('Audiobook project listing must expose a bounded private library, not only one project');
}
if (!audiobookPage.includes('cancelEntireBookRender') || !audiobookPage.includes('/cancel')) {
  fail('Audiobook Studio must expose the durable render cancellation API');
}
if (!app.includes("lazy(() => import('@/pages/QuantLab'))") || !app.includes("{route === 'quant' && <QuantLabPage />}")) {
  fail('Quant Lab route must lazy-load and render the QuantLab page');
}
const auth = readText('src/server/routes/auth.ts');
if (!auth.includes("path.startsWith('/api/quant/')")) {
  fail('Quant API paths must require a verified signed-in user');
}
if (!readText('Dockerfile').includes('python3') || !readText('Dockerfile').includes('quant-engine ./quant-engine')) {
  fail('Production API image must include the isolated Python quant runtime');
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

const paScript = readText('src/skills/agentPAScript.ts');
const launcher = readText('src/server/launcher.ts');
const agentOps = readText('src/server/routes/agentOperations.ts');
const dashboard = readText('src/pages/Dashboard.tsx');
if (!launcher.includes('await paObserver.start()') || !launcher.includes('stopAgentPA?.()')) {
  fail('API launcher must start and gracefully stop the PA observer');
}
if (!launcher.includes('dbPool.query(\'SELECT 1\')') || !launcher.includes('fastify.redis.ping()')) {
  fail('PA observer must use real PostgreSQL and Redis health probes');
}
if (!paScript.includes('Read-only monitoring continues') || !paScript.includes('healthCheck')) {
  fail('PA observer must report real probe status and remain read-only');
}
if (!agentOps.includes("'/api/agent/ops/pa/status'") || !agentOps.includes('getAgentPAStatus()')) {
  fail('Authenticated agent operations API must expose PA observer status');
}
if (
  !dashboard.includes('PA Agent observer') ||
  !dashboard.includes("import { authenticatedFetch } from '@/lib/authenticatedFetch';") ||
  !dashboard.includes("authenticatedFetch('/api/agent/ops/pa/status'") ||
  dashboard.includes("fetch('/api/agent/ops/pa/status'") ||
  !dashboard.includes("returned a non-JSON response")
) {
  fail('System dashboard must use the authenticated API origin and validate PA observer JSON responses');
}
const paPage = readText('src/pages/PAAgent.tsx');
if (
  !routes.routes?.some((route) => route.id === 'pa' && route.path === '/pa') ||
  !app.includes("lazy(() => import('@/pages/PAAgent'))") ||
  !app.includes("{route === 'pa' && <PAAgentPage />}")
) {
  fail('Personal Assistant must be registered in the route manifest and rendered by the authenticated app shell');
}
if (
  !paPage.includes("authenticatedFetch('/api/agent/ops/pa/status'") ||
  !paPage.includes("authenticatedFetch('/api/agent/ops/tasks'") ||
  !paPage.includes('heartbeatFresh') ||
  !paPage.includes('Read-only PA boundary')
) {
  fail('Personal Assistant workspace must use authenticated status/task APIs, verify heartbeat freshness and disclose its read-only boundary');
}
if (!dashboard.includes("href: '#/pa'") || !dashboard.includes('Personal Assistant')) {
  fail('System dashboard must link to the dedicated Personal Assistant workspace');
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
