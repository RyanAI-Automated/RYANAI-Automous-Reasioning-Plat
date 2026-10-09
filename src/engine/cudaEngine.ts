// src/engine/cudaEngine.ts
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

let nativeCudaModule: { runCudaInference: (prompt: string) => string } | null = null;

try {
  // Load the compiled Node-API addon
  nativeCudaModule = require(path.resolve(process.cwd(), "build/Release/ryan_cuda_native.node"));
} catch {
  console.warn("[RyanAI CUDA Warning] Native CUDA module not compiled yet. Falling back to software simulation mode.");
}

export class CudaInferenceEngine {
  /** Runs inference through the native CUDA addon if available, otherwise returns a simulated fallback response. */
  public static async generate(prompt: string): Promise<string> {
    if (nativeCudaModule && typeof nativeCudaModule.runCudaInference === "function") {
      try {
        return nativeCudaModule.runCudaInference(prompt);
      } catch (error: unknown) {
        console.error("[CUDA Execution Error]:", (error instanceof Error ? error.message : String(error)));
      }
    }

    // Fallback response if CUDA addon isn't built in current environment
    return `[Fallback Engine] Simulated response for: "${prompt}"`;
  }
}