import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface InferenceEngine {
  process: (input: unknown) => Promise<unknown>;
  isHardwareAccelerated: boolean;
}

let activeEngine: InferenceEngine;

try {
  // Resolve path to compiled .node binary
  const addonPath = path.resolve(__dirname, '../../../build/Release/ryan_cuda_engine.node');
  const nativeCuda = require(addonPath);

  activeEngine = {
    ...nativeCuda,
    isHardwareAccelerated: true,
  };
  console.log('⚡ [CUDA Engine] Native GPU acceleration loaded successfully.');
} catch (err) {
  console.warn(
    '⚠️ [CUDA Engine] Native addon not available or GPU missing. Falling back to CPU engine.',
    (err as Error).message
  );

  // Fall back to JS/CPU implementation
  const cpuFallback = await import('./cpuFallbackEngine.js');
  
  activeEngine = {
    ...cpuFallback.default,
    isHardwareAccelerated: false,
  };
}

export default activeEngine;
