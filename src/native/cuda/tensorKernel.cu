#include <cuda_runtime.h>
#include <cmath>

// CUDA Kernel for high-throughput tensor weight scaling and normalization
__global__ void scaleAndNormalizeKernel(float* d_data, int size, float scaleFactor) {
    int idx = blockDim.x * blockIdx.x + threadIdx.x;
    if (idx < size) {
        float val = d_data[idx];
        d_data[idx] = (val * scaleFactor) / (1.0f + fabsf(val));
    }
}

extern "C" {
    // Host wrapper function called from C++ / Node-API
    cudaError_t launchScaleAndNormalize(float* h_data, size_t length, float scaleFactor) {
        float* d_data = nullptr;
        size_t bytes = length * sizeof(float);

        cudaError_t err = cudaMalloc(&d_data, bytes);
        if (err != cudaSuccess) return err;

        err = cudaMemcpy(d_data, h_data, bytes, cudaMemcpyHostToDevice);
        if (err != cudaSuccess) {
            cudaFree(d_data);
            return err;
        }

        int threadsPerBlock = 256;
        int blocksPerGrid = (length + threadsPerBlock - 1) / threadsPerBlock;
        scaleAndNormalizeKernel<<<blocksPerGrid, threadsPerBlock>>>(d_data, length, scaleFactor);

        err = cudaMemcpy(h_data, d_data, bytes, cudaMemcpyDeviceToHost);
        cudaFree(d_data);

        return err;
    }
}