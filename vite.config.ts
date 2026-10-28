
import { defineConfig, loadEnv } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function validateVercelApiOrigin(
  primaryValue: string | undefined,
  legacyValue: string | undefined,
): string | undefined {
  // A nonblank primary value always takes precedence over the legacy setting.
  const primary = primaryValue?.trim();
  const legacy = legacyValue?.trim();
  const configured = primary ? primary : legacy;

  const errorMessage = 'Set VITE_API_BASE_URL to the HTTPS origin of your separate API deployment';

  if (!configured) {
    throw new Error(errorMessage);
  }

  let parsed: URL;

  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(errorMessage);
  }

  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(errorMessage);
  }

  const getDeploymentHostname = (value: string | undefined): string => {
    if (!value?.trim()) return '';

    try {
      const normalized = value.trim().includes('://')
        ? value.trim()
        : `https://${value.trim()}`;
      return new URL(normalized).hostname.toLowerCase();
    } catch {
      return value.trim().toLowerCase();
    }
  };

  const frontendHosts = [
    getDeploymentHostname(process.env.VERCEL_URL),
    getDeploymentHostname(process.env.VERCEL_PROJECT_PRODUCTION_URL),
  ].filter(Boolean);

  if (frontendHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error(errorMessage);
  }

  return parsed.origin;
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const forbiddenClientSecrets = [
    'VITE_OPENAI_API_KEY',
    'VITE_NVIDIA_API_KEY',
    'VITE_QWEN_API_KEY',
    'VITE_TOGETHER_API_KEY',
    'VITE_OPENROUTER_API_KEY',
    'VITE_MODEL_GATEWAY_API_KEY',
    'VITE_LOCAL_API_KEY',
  ];
  const exposedSecretNames = forbiddenClientSecrets.filter(
    (name) => Boolean(env[name]?.trim() || process.env[name]?.trim()),
  );
  if (exposedSecretNames.length > 0) {
    throw new Error(
      `Refusing to build with provider credentials in browser-exposed variables: ${exposedSecretNames.join(', ')}. Configure these as server-only variables without the VITE_ prefix.`,
    );
  }

  const primaryApiUrl =
    env.VITE_API_BASE_URL ?? process.env.VITE_API_BASE_URL;
  const legacyApiUrl =
    env.VITE_API_URL ?? process.env.VITE_API_URL;

  const isVercelProductionBuild =
    command === 'build' &&
    mode === 'production' &&
    process.env.VERCEL === '1';

  const validatedApiUrl = isVercelProductionBuild
    ? validateVercelApiOrigin(primaryApiUrl, legacyApiUrl)
    : undefined;

  const targetApiUrl =
    validatedApiUrl ||
    primaryApiUrl?.trim() ||
    legacyApiUrl?.trim() ||
    'http://127.0.0.1:3001';

  const targetWsUrl =
    env.VITE_WS_URL ||
    process.env.VITE_WS_URL ||
    targetApiUrl.replace(/^http/, 'ws');

  const serverPort = Number(
    env.VITE_PORT || process.env.VITE_PORT || 1420,
  );

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    test: {
      globals: true,
      environment: 'node',
      // This test needs a live database and imports ../server.js, which no longer
      // exists. It cannot pass until it is rewritten against src/server/launcher.ts.
      exclude: [
        ...configDefaults.exclude,
        'src/tests/auth.test.ts',
        // Written for node:test and run by `npm run test:stack-validator`.
        'scripts/validate-stack-manifest.test.mjs',
      ],
      env: {
        RYAN_PATCH_VERIFIER_IMAGE:
          'ryanai/verifier@sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
    },
    server: {
      host: '0.0.0.0',
      port: serverPort,
      strictPort: true,
      watch: {
        usePolling: true,
      },
      proxy: {
        '/api': {
          target: targetApiUrl,
          changeOrigin: true,
          secure: true,
        },
        '/health': {
          target: targetApiUrl,
          changeOrigin: true,
          secure: true,
        },
        '/ws': {
          target: targetWsUrl,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: mode !== 'production',
    },
  };
});
