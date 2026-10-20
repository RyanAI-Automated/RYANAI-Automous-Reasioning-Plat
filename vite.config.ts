import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vercel only hosts the static frontend, so a Vercel build must point the
 * browser at the separately hosted Fastify API. Fail the build early instead
 * of shipping a bundle whose same-origin /api requests return 404.
 */
function assertVercelApiOrigin(env: Record<string, string | undefined>): void {
  const apiBaseUrl = env.VITE_API_BASE_URL?.trim() || env.VITE_API_URL?.trim();
  let apiUrl: URL | undefined;
  try {
    apiUrl = apiBaseUrl ? new URL(apiBaseUrl) : undefined;
  } catch {
    // Reported as a deployment configuration error below.
  }
  if (
    !apiUrl ||
    apiUrl.protocol !== 'https:' ||
    apiUrl.pathname !== '/' ||
    apiUrl.search ||
    apiUrl.hash ||
    apiUrl.username ||
    apiUrl.password ||
    [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL].includes(apiUrl.host)
  ) {
    throw new Error(
      'Set VITE_API_BASE_URL to the HTTPS origin of the separately hosted Fastify API (without /api or a route path), then rebuild. Vercel only hosts the frontend; same-origin /api requests return 404 NOT_FOUND.',
    );
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  if (command === 'build' && (env.VERCEL || process.env.VERCEL) === '1') {
    assertVercelApiOrigin({ ...env, ...process.env });
  }

  const targetApiUrl = env.VITE_API_URL || process.env.VITE_API_URL || 'http://127.0.0.1:3001';
  const targetWsUrl = env.VITE_WS_URL || process.env.VITE_WS_URL || targetApiUrl.replace(/^http/, 'ws');
  const serverPort = Number(env.VITE_PORT || process.env.VITE_PORT || 1420);

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
      env: {
        RYAN_PATCH_VERIFIER_IMAGE: "ryanai/verifier@sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
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
          secure: false,
        },
        '/health': {
          target: targetApiUrl,
          changeOrigin: true,
          secure: false,
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