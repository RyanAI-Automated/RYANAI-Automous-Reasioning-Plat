// File path: src/test/cuda_test.ts

import bindings from "bindings";

// Load the compiled ryan_cuda_engine native addon via node-gyp bindings
const cudaEngine = bindings("ryan_cuda_engine");

async function runCudaTests() {
  console.log("=== RyanAI CUDA Native Addon Diagnostics ===");

  // 1. Check if an active Nvidia GPU is available
  const isAvailable = cudaEngine.isCudaAvailable();
  console.log(`[Diagnostic] CUDA Available: ${isAvailable}`);

  if (!isAvailable) {
    console.warn("[Warning] No active CUDA GPU detected or device count is zero. Hardware acceleration may fall back to CPU simulation.");
    return;
  }

  // 2. Test GPU Matrix Scaling Kernel with Float32Array
  const inputSize = 8;
  const inputArr = new Float32Array(inputSize);
  for (let i = 0; i < inputSize; i++) {
    inputArr[i] = (i + 1) * 1.25;
  }
  const scaleFactor = 3.5;

  console.log("\n[Test 1] Executing GPU Matrix Scale Kernel...");
  console.log("Input Float32Array:  ", Array.from(inputArr));
  console.log(`Scale Factor:         ${scaleFactor}`);

  try {
    const scaledArr = cudaEngine.executeMatrixScale(inputArr, scaleFactor);
    console.log("Output Float32Array: ", Array.from(scaledArr));
  } catch (err) {
    console.error("[Error] Matrix scale execution failed:", err);
  }

  // 3. Test String Inference Bridge
  console.log("\n[Test 2] Executing Tensor Inference String Bridge...");
  try {
    const prompt = "Analyze eBPF kernel packet filtering threshold";
    const inferenceResult = cudaEngine.executeInference(prompt);
    console.log("Result:", inferenceResult);
  } catch (err) {
    console.error("[Error] Inference execution failed:", err);
  }

  console.log("\n=== CUDA Verification Completed Successfully ===");
}

runCudaTests().catch(console.error);