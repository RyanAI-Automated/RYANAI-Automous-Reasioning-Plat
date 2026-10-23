#include <iostream>
#include <vector>
#include <cuda_runtime.h>

class CudaTensorCache {
public:
    explicit CudaTensorCache(size_t capacity_bytes) {
        cudaMalloc(&device_buffer_, capacity_bytes);
        std::cout << "[CUDA Cache] Allocated " << capacity_bytes << " bytes in VRAM." << std::endl;
    }

    ~CudaTensorCache() {
        cudaFree(device_buffer_);
    }

    void store_attention_state(const float* host_data, size_t size_bytes) {
        cudaMemcpy(device_buffer_, host_data, size_bytes, cudaMemcpyHostToDevice);
    }

private:
    void* device_buffer_ = nullptr;
};