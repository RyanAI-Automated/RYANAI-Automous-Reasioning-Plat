
import { defineConfig, loadEnv } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
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

  const targetApiUrl =
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
        // Written for node:test and run explicitly with `node --test` in CI.
        'scripts/redis-probe.test.mjs',
        // Migration-readiness tests use node:test and run via `npm run test:migration:audit`.
        'scripts/audit-prisma-migration-readiness.test.mjs',
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
