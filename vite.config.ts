import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

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
      strictPort: mode === 'desktop' || process.env.VITE_STRICT_PORT === 'true',
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