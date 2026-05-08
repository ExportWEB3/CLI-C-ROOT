// process_utils.cpp - Enhanced process enumeration implementation
#define _WIN32_WINNT 0x0600  // Windows Vista or later
#define WIN32_LEAN_AND_MEAN
#include "process_utils.h"
#include <windows.h>
#include <tlhelp32.h>
#include <psapi.h>
#include <sddl.h>
#include <iostream>
#include <sstream>
#include <iomanip>
#include <vector>
#include <algorithm>

#pragma comment(lib, "psapi.lib")
#pragma comment(lib, "advapi32.lib")


// Get process architecture (x86 or x64)
std::string GetProcessArchitecture(DWORD pid) {
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!hProcess) {
        return "Unknown";
    }
    
    BOOL isWow64 = FALSE;
    if (!IsWow64Process(hProcess, &isWow64)) {
        CloseHandle(hProcess);
        return "Unknown";
    }
    
    CloseHandle(hProcess);
    
    SYSTEM_INFO sysInfo;
    GetNativeSystemInfo(&sysInfo);
    
    if (sysInfo.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_AMD64) {
        return isWow64 ? "x86" : "x64";
    } else if (sysInfo.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_INTEL) {
        return "x86";
    }
    
    return "Unknown";
}

// Get process username (SID to username)
std::string GetProcessUsername(DWORD pid) {
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION, FALSE, pid);
    if (!hProcess) {
        return "Unknown";
    }
    
    HANDLE hToken = NULL;
    if (!OpenProcessToken(hProcess, TOKEN_QUERY, &hToken)) {
        CloseHandle(hProcess);
        return "Unknown";
    }
    
    DWORD tokenInfoSize = 0;
    GetTokenInformation(hToken, TokenUser, NULL, 0, &tokenInfoSize);
    
    if (tokenInfoSize == 0) {
        CloseHandle(hToken);
        CloseHandle(hProcess);
        return "Unknown";
    }
    
    PTOKEN_USER pTokenUser = (PTOKEN_USER)LocalAlloc(LPTR, tokenInfoSize);
    if (!pTokenUser) {
        CloseHandle(hToken);
        CloseHandle(hProcess);
        return "Unknown";
    }
    
    std::string result = "Unknown";
    if (GetTokenInformation(hToken, TokenUser, pTokenUser, tokenInfoSize, &tokenInfoSize)) {
        LPSTR szSid = NULL;
        if (ConvertSidToStringSidA(pTokenUser->User.Sid, &szSid)) {
            // Try to get username from SID
            char name[256];
            char domain[256];
            DWORD nameSize = sizeof(name);
            DWORD domainSize = sizeof(domain);
            SID_NAME_USE sidUse;
            
            if (LookupAccountSidA(NULL, pTokenUser->User.Sid, name, &nameSize, domain, &domainSize, &sidUse)) {
                result = std::string(domain) + "\\" + std::string(name);
            } else {
                result = szSid; // Fallback to SID string
            }
            LocalFree(szSid);
        }
    }
    
    LocalFree(pTokenUser);
    CloseHandle(hToken);
    CloseHandle(hProcess);
    
    return result;
}

// Get process executable path
std::string GetProcessPath(DWORD pid) {
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pid);
    if (!hProcess) {
        return "";
    }
    
    char path[MAX_PATH];
    DWORD pathSize = sizeof(path);
    
    // Use GetModuleFileNameEx as fallback for older Windows versions
    if (GetModuleFileNameExA(hProcess, NULL, path, pathSize)) {
        CloseHandle(hProcess);
        return std::string(path);
    }
    
    CloseHandle(hProcess);
    return "";
}

// Get process memory KB
DWORD GetProcessMemoryKB(DWORD pid) {
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pid);
    if (!hProcess) {
        return 0;
    }
    
    PROCESS_MEMORY_COUNTERS pmc;
    if (GetProcessMemoryInfo(hProcess, &pmc, sizeof(pmc))) {
        CloseHandle(hProcess);
        return static_cast<DWORD>(pmc.WorkingSetSize / 1024);
    }
    
    CloseHandle(hProcess);
    return 0;
}

// Is64BitProcess
bool Is64BitProcess(HANDLE hProcess) {
    if (!hProcess) return false;
    BOOL isWow64 = FALSE;
    if (!IsWow64Process(hProcess, &isWow64)) return false;
    return !isWow64;
}

// Main function to get process list - optimized: single OpenProcess per PID
std::vector<ProcessInfo> GetProcessList() {
    std::vector<ProcessInfo> processes;
    
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnapshot == INVALID_HANDLE_VALUE) {
        return processes;
    }
    
    PROCESSENTRY32 pe32;
    pe32.dwSize = sizeof(PROCESSENTRY32);
    
    if (!Process32First(hSnapshot, &pe32)) {
        CloseHandle(hSnapshot);
        return processes;
    }
    
    do {
        ProcessInfo info;
        info.pid = pe32.th32ProcessID;
        info.name = pe32.szExeFile;
        info.memoryKB = 0;
        info.architecture = "Unknown";
        info.username = "Unknown";
        info.path = "";
        info.priorityClass = 0;
        
        // Open process ONCE and reuse handle for all queries
        HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, info.pid);
        if (hProcess) {
            // Get memory
            PROCESS_MEMORY_COUNTERS pmc;
            if (GetProcessMemoryInfo(hProcess, &pmc, sizeof(pmc))) {
                info.memoryKB = static_cast<DWORD>(pmc.WorkingSetSize / 1024);
            }
            
            // Get architecture
            BOOL isWow64 = FALSE;
            if (IsWow64Process(hProcess, &isWow64)) {
                SYSTEM_INFO sysInfo;
                GetNativeSystemInfo(&sysInfo);
                if (sysInfo.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_AMD64) {
                    info.architecture = isWow64 ? "x86" : "x64";
                } else {
                    info.architecture = "x86";
                }
            }
            
            // Get path
            char path[MAX_PATH];
            if (GetModuleFileNameExA(hProcess, NULL, path, sizeof(path))) {
                info.path = path;
            }
            
            // Get priority class
            info.priorityClass = GetPriorityClass(hProcess);
            
            // Get username (from same handle)
            HANDLE hToken = NULL;
            if (OpenProcessToken(hProcess, TOKEN_QUERY, &hToken)) {
                DWORD tokenInfoSize = 0;
                GetTokenInformation(hToken, TokenUser, NULL, 0, &tokenInfoSize);
                if (tokenInfoSize > 0) {
                    PTOKEN_USER pTokenUser = (PTOKEN_USER)LocalAlloc(LPTR, tokenInfoSize);
                    if (pTokenUser) {
                        if (GetTokenInformation(hToken, TokenUser, pTokenUser, tokenInfoSize, &tokenInfoSize)) {
                            char name[256], domain[256];
                            DWORD nameSize = sizeof(name), domainSize = sizeof(domain);
                            SID_NAME_USE sidUse;
                            if (LookupAccountSidA(NULL, pTokenUser->User.Sid, name, &nameSize, domain, &domainSize, &sidUse)) {
                                info.username = std::string(domain) + "\\" + std::string(name);
                            }
                        }
                        LocalFree(pTokenUser);
                    }
                }
                CloseHandle(hToken);
            }
            
            CloseHandle(hProcess);
        }
        
        processes.push_back(info);
        
    } while (Process32Next(hSnapshot, &pe32));
    
    CloseHandle(hSnapshot);
    return processes;
}

// Convert process list to JSON - updated fields
std::string GetProcessListJSON() {
    auto processes = GetProcessList();
    std::ostringstream json;
    
    json << "[";
    bool first = true;
    
    for (const auto& proc : processes) {
        if (!first) {
            json << ",";
        }
        first = false;
        
        json << "{"
             << "\"pid\":" << proc.pid << ","
             << "\"name\":\"" << escapeJson(proc.name) << "\","
             << "\"memory\":" << proc.memoryKB << ","
             << "\"architecture\":\"" << escapeJson(proc.architecture) << "\","
             << "\"username\":\"" << escapeJson(proc.username) << "\","
             << "\"path\":\"" << escapeJson(proc.path) << "\","
             << "\"priority\":" << proc.priorityClass
             << "}";
    }
    
    json << "]";
    return json.str();
}

// Test function updated
int main_test() {
    std::cout << "Testing process enumeration..." << std::endl;
    
    auto processes = GetProcessList();
    std::cout << "Found " << processes.size() << " processes" << std::endl;
    
    int count = 0;
    for (const auto& proc : processes) {
        if (count++ >= 5) break;
        
        std::cout << "PID: " << proc.pid 
                  << ", Name: " << proc.name
                  << ", Username: " << proc.username
                  << ", Arch: " << proc.architecture
                  << ", Memory: " << (proc.memoryKB / 1024.0) << " MB"
                  << std::endl;
    }
    
    std::string json = GetProcessListJSON();
    std::cout << "\nJSON (first 500 chars): " << json.substr(0, 500) << "..." << std::endl;
    
    return 0;
}

// Additional helper functions
bool TerminateProcessByPid(DWORD pid) {
    HANDLE hProc = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
    if (!hProc) return false;
    BOOL res = TerminateProcess(hProc, 0);
    CloseHandle(hProc);
    return res != FALSE;
}

bool SuspendProcess(DWORD pid) {
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, pid);
    if (hSnapshot == INVALID_HANDLE_VALUE) return false;
    
    THREADENTRY32 te;
    te.dwSize = sizeof(THREADENTRY32);
    bool success = true;
    
    if (Thread32First(hSnapshot, &te)) {
        do {
            if (te.th32OwnerProcessID == pid) {
                HANDLE hThread = OpenThread(THREAD_SUSPEND_RESUME, FALSE, te.th32ThreadID);
                if (hThread) {
                    SuspendThread(hThread);
                    CloseHandle(hThread);
                } else {
                    success = false;
                }
            }
        } while (Thread32Next(hSnapshot, &te));
    }
    
    CloseHandle(hSnapshot);
    return success;
}

bool ResumeProcess(DWORD pid) {
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, pid);
    if (hSnapshot == INVALID_HANDLE_VALUE) return false;
    
    THREADENTRY32 te;
    te.dwSize = sizeof(THREADENTRY32);
    bool success = true;
    
    if (Thread32First(hSnapshot, &te)) {
        do {
            if (te.th32OwnerProcessID == pid) {
                HANDLE hThread = OpenThread(THREAD_SUSPEND_RESUME, FALSE, te.th32ThreadID);
                if (hThread) {
                    ResumeThread(hThread);
                    CloseHandle(hThread);
                } else {
                    success = false;
                }
            }
        } while (Thread32Next(hSnapshot, &te));
    }
    
    CloseHandle(hSnapshot);
    return success;
}

bool GetProcessModules(DWORD pid, char* outputBuffer, DWORD bufferSize, DWORD* bytesWritten) {
    *bytesWritten = 0;
    outputBuffer[0] = '\0';
    
    HANDLE hProc = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pid);
    if (!hProc) return false;
    
    HMODULE hMods[1024];
    DWORD cbNeeded;
    if (!EnumProcessModules(hProc, hMods, sizeof(hMods), &cbNeeded)) {
        CloseHandle(hProc);
        return false;
    }
    
    DWORD numMods = cbNeeded / sizeof(HMODULE);
    DWORD total = 0;
    
    for (DWORD i = 0; i < numMods; ++i) {
        char modName[MAX_PATH];
        if (GetModuleFileNameExA(hProc, hMods[i], modName, sizeof(modName))) {
            MODULEINFO mi;
            if (GetModuleInformation(hProc, hMods[i], &mi, sizeof(mi))) {
                DWORD sizeKB = mi.SizeOfImage / 1024;
                char line[512];
                sprintf(line, "%s 0x%p %u KB\n", modName, mi.lpBaseOfDll, sizeKB);
                DWORD len = strlen(line);
                if (total + len < bufferSize - 1) {
                    strcpy(outputBuffer + total, line);
                    total += len;
                } else {
                    break;
                }
            }
        }
    }
    
    outputBuffer[total] = '\0';
    *bytesWritten = total;
    CloseHandle(hProc);
    return true;
}