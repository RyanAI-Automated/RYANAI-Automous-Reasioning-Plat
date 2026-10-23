// src/inference/index.ts

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

interface NativeCudaEngine {
  executeInference(prompt: string): string;
  executeCUDAInference(payload: string): string;
  executeMatrixScale(arr: Float32Array, scale: number): Float32Array;
  isCudaAvailable(): boolean;
}

let cudaEngine: NativeCudaEngine | null = null;

try {
  cudaEngine = require('../../build/Release/ryan_cuda_engine.node') as NativeCudaEngine;
  console.log("[Hardware] Native CUDA Engine (ryan_cuda_engine) loaded successfully.");
} catch {
  try {
    cudaEngine = require('../../build/Release/cuda_inference_bridge.node') as NativeCudaEngine;
    console.log("[Hardware] CUDA Inference Bridge loaded successfully.");
  } catch {
    console.warn("[Hardware] Native CUDA bindings not loaded. Operating in CPU Fallback mode.");
  }
}

export const runHardwareInference = (payload: string): string => {
  if (cudaEngine && typeof cudaEngine.executeCUDAInference === 'function') {
    try {
      return cudaEngine.executeCUDAInference(payload);
    } catch (error) {
      console.error("[Hardware] Error during CUDA inference execution:", error);
    }
  }

  return JSON.stringify({
    cuda_status: "offline",
    fallback: "cpu_simulated",
    compute_time_ms: 0.1,
    processed_payload: payload
  });
};

export const runTensorInference = (prompt: string): string => {
  if (cudaEngine && typeof cudaEngine.executeInference === 'function') {
    try {
      return cudaEngine.executeInference(prompt);
    } catch (error) {
      console.error("[Hardware] Error during Tensor inference execution:", error);
    }
  }

  return `[CPU Engine] Simulated tensor embeddings for: "${prompt}". Hardware latency: 0.05ms (Fallback).`;
};

export const isCudaHardwareAvailable = (): boolean => {
  if (cudaEngine && typeof cudaEngine.isCudaAvailable === 'function') {
    return cudaEngine.isCudaAvailable();
  }
  return false;
};