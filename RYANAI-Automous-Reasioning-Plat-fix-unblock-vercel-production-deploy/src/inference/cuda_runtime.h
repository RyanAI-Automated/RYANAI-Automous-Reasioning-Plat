/**
 * @file cuda_runtime.h
 * @brief Clean, portable CUDA Runtime API header stub for fallback & cross-platform support.
 */

#ifndef CUDA_RUNTIME_H
#define CUDA_RUNTIME_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ==========================================================================
 * CUDA Qualifier Stubs (For non-NVCC standard C/C++ compilers)
 * ========================================================================== */
#ifndef __CUDACC__
    #define __host__
    #define __device__
    #define __global__
    #define __shared__
    #define __constant__
    #define __restrict__
#endif

/* ==========================================================================
 * Error Codes & Enums
 * ========================================================================== */
typedef enum {
    cudaSuccess                  = 0,
    cudaErrorInvalidValue        = 1,
    cudaErrorMemoryAllocation    = 2,
    cudaErrorInitializationError = 3,
    cudaErrorInvalidDevice       = 10,
    cudaErrorNoDevice            = 38,
    cudaErrorNotYetImplemented   = 56,
    cudaErrorUnknown             = 999
} cudaError_t;

typedef enum {
    cudaMemcpyHostToHost     = 0,
    cudaMemcpyHostToDevice   = 1,
    cudaMemcpyDeviceToHost   = 2,
    cudaMemcpyDeviceToDevice = 3,
    cudaMemcpyDefault        = 4
} cudaMemcpyKind;

/* Opaque handles */
typedef struct cudaStream_t* cudaStream_t;
typedef struct cudaEvent_t*  cudaEvent_t;

/* Device properties stub struct */
struct cudaDeviceProp {
    char   name[256];
    size_t totalGlobalMem;
    size_t sharedMemPerBlock;
    int    regsPerBlock;
    int    warpSize;
    int    maxThreadsPerBlock;
    int    maxThreadsDim[3];
    int    maxGridSize[3];
    int    totalConstMem;
    int    major;
    int    minor;
    int    clockRate;
    int    textureAlignment;
    int    deviceOverlap;
    int    multiProcessorCount;
    int    kernelExecTimeoutEnabled;
    int    integrated;
    int    canMapHostMemory;
    int    computeMode;
};

/* ==========================================================================
 * Runtime API Function Declarations
 * ========================================================================== */

const char*   cudaGetErrorString(cudaError_t error);
cudaError_t   cudaGetLastError(void);
cudaError_t   cudaPeekAtLastError(void);

/* Device Management */
cudaError_t   cudaGetDeviceCount(int* count);
cudaError_t   cudaSetDevice(int device);
cudaError_t   cudaGetDevice(int* device);
cudaError_t   cudaGetDeviceProperties(struct cudaDeviceProp* prop, int device);
cudaError_t   cudaDeviceSynchronize(void);

/* Memory Management */
cudaError_t   cudaMalloc(void** devPtr, size_t size);
cudaError_t   cudaFree(void* devPtr);
cudaError_t   cudaMemcpy(void* dst, const void* src, size_t count, cudaMemcpyKind kind);
cudaError_t   cudaMemcpyAsync(void* dst, const void* src, size_t count, cudaMemcpyKind kind, cudaStream_t stream);
cudaError_t   cudaMemset(void* devPtr, int value, size_t count);

#ifdef __cplusplus
}
#endif

#endif /* CUDA_RUNTIME_H */