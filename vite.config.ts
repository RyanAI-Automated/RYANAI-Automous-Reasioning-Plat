import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: Number(env.VITE_PORT || process.env.VITE_PORT || 1420),
      strictPort: true,
      watch: {
        usePolling: true,
      },
      proxy: {
        '/api': {
          target: env.VITE_API_URL || process.env.VITE_API_URL || 'http://127.0.0.1:3000',
          changeOrigin: true,
          secure: false,
        },
        '/health': {
          target: env.VITE_API_URL || process.env.VITE_API_URL || 'http://127.0.0.1:3000',
          changeOrigin: true,
          secure: false,
        },
        '/ws': {
          target: env.VITE_API_URL || process.env.VITE_API_URL || 'ws://127.0.0.1:3000',
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
