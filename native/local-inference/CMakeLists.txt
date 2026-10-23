cmake_minimum_required(VERSION 3.20)
project(ryanai_local_inference LANGUAGES CXX)

option(RYANAI_ENABLE_CUDA "Enable the future CUDA backend" OFF)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(ryanai-local-inference src/main.cpp)
target_compile_definitions(ryanai-local-inference PRIVATE
  RYANAI_ENABLE_CUDA=$<BOOL:${RYANAI_ENABLE_CUDA}>
)

if(RYANAI_ENABLE_CUDA)
  enable_language(CUDA)
  message(STATUS "CUDA backend selected; provide model kernels and weights for production inference.")
endif()