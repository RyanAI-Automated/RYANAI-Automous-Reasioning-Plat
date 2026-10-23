import { build } from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

build({
  entryPoint: [resolve(__dirname, '../src/mcp/systemServer.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: resolve(__dirname, '../dist/api/reasoningRoute.js'),
  format: 'cjs',
  sourcemap: true,
  external: ['fsevents']
}).catch((err) => {
  console.error('API Build Failed:', err);
  process.exit(1);
});