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
  const repositoryRoot = path.resolve(
    __dirname,
    import.meta.url.endsWith('.ts') ? '../../..' : '../../../..',
  );
  const addonPath = path.join(repositoryRoot, 'build/Release/ryan_cuda_engine.node');
  const nativeCuda = require(addonPath);

  activeEngine = {
    process: async (input) => nativeCuda.executeInference(String(input)),
    isHardwareAccelerated: nativeCuda.isCudaAvailable(),
  };
  console.log(
    `[CUDA Engine] Native addon loaded (GPU acceleration: ${activeEngine.isHardwareAccelerated}).`,
  );
} catch (err) {
  console.warn(
    '⚠️ [CUDA Engine] Native addon not available or GPU missing. Falling back to CPU engine.',
    (err as Error).message,
  );

  // Fall back to JS/CPU implementation
  const cpuFallback = await import('../../inference/index.js');

  activeEngine = {
    process: async (input) => cpuFallback.runTensorInference(String(input)),
    isHardwareAccelerated: false,
  };
}

export default activeEngine;
