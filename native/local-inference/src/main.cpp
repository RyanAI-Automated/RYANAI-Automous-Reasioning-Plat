#include <iostream>
#include <string>

int main() {
    std::ios::sync_with_stdio(false);
    std::string prompt;
    if (!std::getline(std::cin, prompt)) {
        return 0;
    }

#if RYANAI_ENABLE_CUDA
    constexpr const char* backend = "cuda-stub";
#else
    constexpr const char* backend = "cpu-fallback";
#endif

    std::cout << "{\"backend\":\"" << backend
              << "\",\"status\":\"stub\",\"prompt_length\":"
              << prompt.size()
              << ",\"message\":\"Local model bridge ready; attach signed weights and kernels before production inference.\"}"
              << std::endl;
    return 0;
}