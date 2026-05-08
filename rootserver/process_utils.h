// process_utils.h - Enhanced process enumeration utilities
#ifndef PROCESS_UTILS_H
#define PROCESS_UTILS_H

#include <windows.h>
#include <string>
#include <vector>

// Process information structure
struct ProcessInfo {
    DWORD pid;
    std::string name;
    DWORD memoryKB;
    std::string architecture;  // "x86", "x64", or "Unknown"
    std::string username;
    std::string path;
    DWORD priorityClass;       // Priority class value (IDLE=64, NORMAL=32, HIGH=128, REALTIME=256)
};

// Function declarations
std::vector<ProcessInfo> GetProcessList();
std::string GetProcessListJSON();
std::string GetProcessArchitecture(DWORD pid);
std::string GetProcessUsername(DWORD pid);
std::string GetProcessPath(DWORD pid);
DWORD GetProcessMemoryKB(DWORD pid);
bool Is64BitProcess(HANDLE hProcess);
bool TerminateProcessByPid(DWORD pid);
bool SuspendProcess(DWORD pid);
bool ResumeProcess(DWORD pid);
bool GetProcessModules(DWORD pid, char* outputBuffer, DWORD bufferSize, DWORD* bytesWritten);

// Helper function declaration (defined in main.cpp)
std::string escapeJson(const std::string& input);

#endif // PROCESS_UTILS_H