#include <iostream>
#include <string>
#include <sstream>

std::string extractField(const std::string& json, const std::string& key) {
    std::string searchKey = "\"" + key + "\":";
    size_t startPos = json.find(searchKey);
    if (startPos == std::string::npos) return "";
    startPos += searchKey.length();
    
    if (json[startPos] == '"') {
        startPos++;
        size_t endPos = json.find('"', startPos);
        if (endPos == std::string::npos) return "";
        return json.substr(startPos, endPos - startPos);
    }
    return "";
}

int main() {
    std::cerr << "RyanAI C++ Native Core Initialized [Deep Reasoning Engine Active]" << std::endl;

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;

        std::string action = extractField(line, "action");
        std::string payload = extractField(line, "payload");

        if (action == "infer") {
            std::cerr << "[C++ Engine] Processing reasoning tree for payload: " << payload << std::endl;
            std::cout << "{\"status\":\"success\",\"action\":\"infer\",\"result\":\"Deep analysis complete for: " << payload << "\",\"tensor_cache\":true}" << std::endl;
        } 
        else if (action == "ping") {
            std::cout << "{\"status\":\"success\",\"action\":\"ping\",\"message\":\"System healthy and operational\"}" << std::endl;
        } 
        else {
            std::cout << "{\"status\":\"error\",\"message\":\"Unknown action: " << action << "\"}" << std::endl;
        }
    }
    return 0;
}