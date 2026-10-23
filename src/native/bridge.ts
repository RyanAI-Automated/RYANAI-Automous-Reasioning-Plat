// File path: ./src/native/bridge.ts

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

interface NativeBinding {
  hello(): string;
  evaluateStep(value: number): number;
  processTokenStream(input: string): string;
  getTimestamp(): string;
}

const require = createRequire(import.meta.url);
const nativeAddonCandidates = [
  fileURLToPath(new URL('../../native/build/Release/ryanai_native.node', import.meta.url).href),
  fileURLToPath(new URL('../../native/build/Debug/ryanai_native.node', import.meta.url).href),
];

function loadNativeBinding(): NativeBinding | null {
  const addonPath = nativeAddonCandidates.find(existsSync);
  if (!addonPath) return null;

  try {
    return require(addonPath) as NativeBinding;
  } catch (error) {
    console.warn('[C++ NATIVE] Addon is present but could not be loaded:', error);
    return null;
  }
}

const nativeBinding = loadNativeBinding();

/**
 * High-level helper to run C++ accelerated inference tensors
 */
export function runCppInference(prompt: string): string {
  if (!nativeBinding) {
    return '[Fallback] Native C++ addon is not built; using the JavaScript engine.';
  }

  return nativeBinding.processTokenStream(prompt);
}