#!/usr/bin/env node
/**
 * RyanAI API Activation Controller
 *
 * Safe-by-default local stack controller. It never sends communications,
 * calls provider APIs, provisions cloud resources, or changes DNS.
 * Starting the API invokes the Compose "migrate" dependency; this is guarded
 * by two explicit acknowledgements.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const CORE_REQUIRED = ['DB_PASSWORD', 'REDIS_PASSWORD', 'JWT_SECRET', 'MCP_AUTH_TOKEN'];
const PLACEHOLDER = /^(?:replace[_ -]?with|changeme|your[_ -]?|<.*>)/i;
const PROVIDERS = {
  NVIDIA: ['NVIDIA_API_KEY'],
  QWEN: ['QWEN_API_KEY'],
  LOGIC: ['LOGIC_API_KEY', 'OPENAI_API_KEY'],
  DEEPSEEK: ['DEEPSEEK_API_KEY'],
  TORCHTPU: ['TORCHTPU_API_KEY'],
};
const COMMUNICATIONS = {
  whatsapp: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_NUMBER', 'TWILIO_WHATSAPP_WEBHOOK_URL', 'RYANAI_OWNER_PHONE'],
  sms: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'TWILIO_SMS_WEBHOOK_URL', 'RYANAI_OWNER_PHONE'],
  voice: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'TWILIO_VOICE_WEBHOOK_URL', 'TWILIO_VOICE_ACTION_URL', 'RYANAI_OWNER_PHONE'],
  email: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'RYANAI_OWNER_EMAIL'],
  inboundEmail: ['RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'RYANAI_OWNER_EMAIL'],
};
const CORE_SERVICES = ['postgres', 'redis', 'api', 'mcp-server', 'web'];

export function parseArgs(argv) {
  const [command = 'preflight', ...flags] = argv;
  const allowed = new Set(['preflight', 'start', 'verify', 'report']);
  if (!allowed.has(command)) throw new Error('Command must be preflight, start, verify, or report.');
  return { command, flags: new Set(flags) };
}

export function loadConfiguration(env = process.env, envFile = '.env') {
  let fileValues = {};
  try { fileValues = dotenv.parse(readFileSync(envFile)); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { ...fileValues, ...env };
}

function present(config, key) {
  const value = config[key];
  return typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDER.test(value.trim());
}

export function validateStartOptions(flags, configuration) {
  if (!flags.has('--allow-committed-migrations') || !flags.has('--confirm-database-backup')) {
    throw new Error('Start is blocked. Review and back up the target database, then pass --allow-committed-migrations --confirm-database-backup. Compose starts the committed migrate service before the API.');
  }
  if (configuration.core.status !== 'configured') {
    throw new Error('Core configuration is incomplete. Run preflight and fix the reported missing values first.');
  }
}

export function configurationReport(config) {
  const core = Object.fromEntries(CORE_REQUIRED.map((key) => [key, present(config, key)]));
  if (present(config, 'MCP_AUTH_TOKEN') && config.MCP_AUTH_TOKEN.trim().length < 32) core.MCP_AUTH_TOKEN = false;

  const providers = Object.fromEntries(Object.entries(PROVIDERS).map(([name, keys]) => {
    const configured = keys.some((key) => present(config, key));
    return [name, { status: configured ? 'configured_unverified' : 'missing_credentials' }];
  }));

  const integrations = {
    supabase: { status: present(config, 'SUPABASE_URL') && (present(config, 'SUPABASE_SERVICE_ROLE_KEY') || present(config, 'SUPABASE_ANON_KEY')) ? 'configured_unverified' : 'missing_credentials' },
    github: { status: present(config, 'RYANAI_GITHUB_TOKEN') ? 'configured_unverified' : 'missing_credentials' },
    jarvis: { status: config.JARVIS_SYNC_ENABLED === 'true' ? (present(config, 'JARVIS_BASE_URL') && present(config, 'JARVIS_API_TOKEN') ? 'configured_unverified' : 'blocked_missing_credentials') : 'disabled' },
    mcpjungle: { status: present(config, 'MCPJUNGLE_DB_PASSWORD') ? 'configured_unverified' : 'disabled' },
    cloudflareTunnel: { status: present(config, 'CLOUDFLARE_TUNNEL_TOKEN') ? 'configured_unverified_not_started' : 'disabled' },
  };

  const communications = Object.fromEntries(Object.entries(COMMUNICATIONS).map(([channel, keys]) => {
    const configured = keys.every((key) => present(config, key));
    return [channel, { status: configured ? 'configured_unverified' : 'missing_credentials' }];
  }));

  return {
    core: { status: Object.values(core).every(Boolean) ? 'configured' : 'blocked', checks: core },
    providers,
    integrations,
    communications,
    integrationsNote: 'Configured means environment values are present only. Authentication, callback registration and delivery are not verified.',
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 'unknown'}.`);
}

function compose(args, options) {
  run('docker', ['compose', ...args], options);
}

export async function checkEndpoint(label, url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'not reachable';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json().catch(() => ({}));
      if (label === 'API' && (body.status !== 'online' || body.services?.database !== true || body.services?.redis !== true)) {
        throw new Error('API health payload does not confirm database and Redis readiness');
      }
      return { status: 'healthy', url, ...(label === 'API' ? { database: true, redis: true } : {}) };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'request failed';
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  return { status: 'unhealthy', url, diagnostic: lastError };
}

export async function verifyRuntime(config = process.env, options = {}) {
  const apiUrl = config.RYANAI_API_HEALTH_URL || 'http://127.0.0.1:3000/health';
  const mcpUrl = config.RYANAI_MCP_HEALTH_URL || 'http://127.0.0.1:8765/health';
  const webUrl = config.RYANAI_WEB_HEALTH_URL || 'http://127.0.0.1:9090/health';
  const [api, mcp, web] = await Promise.all([
    checkEndpoint('API', apiUrl, options.timeoutMs),
    checkEndpoint('MCP', mcpUrl, options.timeoutMs),
    checkEndpoint('Web', webUrl, options.timeoutMs),
  ]);

  let comms = { status: 'unavailable', diagnostic: 'API health check failed; communications status was not queried.' };
  if (api.status === 'healthy') {
    try {
      const response = await fetch(config.RYANAI_COMMS_STATUS_URL || 'http://127.0.0.1:3000/api/comms/status', {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      comms = {
        status: body.status === 'configuration_snapshot' ? 'configuration_snapshot' : 'unknown',
        channels: body.channels ?? {},
        note: body.note ?? 'No provider connectivity or delivery is implied.',
      };
    } catch (error) {
      comms = { status: 'unavailable', diagnostic: error instanceof Error ? error.message : 'request failed' };
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    runtime: { api, mcp, web },
    communications: comms,
    note: 'No outbound message, phone call, provider challenge, webhook, cloud deployment or DNS operation was performed.',
  };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { command, flags } = parseArgs(argv);
  const config = loadConfiguration(env);
  const configuration = configurationReport(config);

  if (command === 'preflight') {
    let composeConfig = 'not_checked';
    if (!flags.has('--skip-compose-check')) {
      compose(['config', '--quiet']);
      composeConfig = 'valid';
    }
    const result = { command, composeConfig, configuration };
    print(result);
    return configuration.core.status === 'configured' ? 0 : 1;
  }

  if (command === 'start') {
    validateStartOptions(flags, configuration);
    compose(['config', '--quiet']);
    compose(['up', '--build', '--detach', '--wait', ...CORE_SERVICES]);
    print({ command, status: 'compose_start_completed', services: CORE_SERVICES, migrations: 'committed migrations were allowed by explicit operator acknowledgement' });
    return 0;
  }

  if (command === 'verify') {
    const runtime = await verifyRuntime(config);
    print({ command, configuration, runtime });
    return Object.values(runtime.runtime).every((item) => item.status === 'healthy') ? 0 : 1;
  }

  const runtime = await verifyRuntime(config);
  print({ command, configuration, runtime });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`Activation controller: ${error instanceof Error ? error.message : 'operation failed'}\n`);
    process.exitCode = 1;
  });
}
