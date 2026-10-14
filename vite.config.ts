import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix for Node.js environments where import.meta.dirname isn't available or typed
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Load environment variables based on the current mode (e.g. development, production)
  const env = loadEnv(mode, process.cwd(), '');

  // Extract variables with proper fallback hierarchy
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
