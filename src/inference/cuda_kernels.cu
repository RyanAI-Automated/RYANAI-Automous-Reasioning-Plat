// File path: ./src/inference/cuda_kernels.cu

#include <cuda_runtime.h>
#include <device_launch_parameters.h>
#include <stdio.h>

// CUDA error-checking macro to prevent unhandled VRAM execution faults
#define CHECK_CUDA(call) { \
    cudaError_t err = call; \
    if (err != cudaSuccess) { \
        fprintf(stderr, "CUDA error in %s:%d: %s\n", __FILE__, __LINE__, cudaGetErrorString(err)); \
        return; \
    } \
}

// CUDA Kernel for parallel tensor scaling / matrix operations
__global__ void matrixScaleKernel(float* d_out, const float* d_in, float scale, int size) {
    int idx = blockDim.x * blockIdx.x + threadIdx.x;
    if (idx < size) {
        d_out[idx] = d_in[idx] * scale;
    }
}

extern "C" {
    // Host wrapper function called from C++ N-API bridge
    void launchMatrixScale(float* h_out, const float* h_in, float scale, int size) {
        float *d_in = nullptr, *d_out = nullptr;
        size_t bytes = size * sizeof(float);

        // Allocate device memory on GPU with error checks
        CHECK_CUDA(cudaMalloc((void**)&d_in, bytes));
        CHECK_CUDA(cudaMalloc((void**)&d_out, bytes));

        // Copy data from Host (CPU) to Device (GPU)
        CHECK_CUDA(cudaMemcpy(d_in, h_in, bytes, cudaMemcpyHostToDevice));

        // Configure grid and block dimensions
        int threadsPerBlock = 256;
        int blocksPerGrid = (size + threadsPerBlock - 1) / threadsPerBlock;

        // Launch kernel on Nvidia GPU
        matrixScaleKernel<<<blocksPerGrid, threadsPerBlock>>>(d_out, d_in, scale, size);
        CHECK_CUDA(cudaGetLastError());
        CHECK_CUDA(cudaDeviceSynchronize());

        // Copy results back from Device (GPU) to Host (CPU)
        CHECK_CUDA(cudaMemcpy(h_out, d_out, bytes, cudaMemcpyDeviceToHost));

        // Free device memory
        cudaFree(d_in);
        cudaFree(d_out);
    }
}