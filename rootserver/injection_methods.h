// injection_methods.h - Multiple DLL injection techniques
#ifndef INJECTION_METHODS_H
#define INJECTION_METHODS_H

#include <windows.h>
#include <string>

// Injection method types
enum InjectionMethod {
    METHOD_CREATE_REMOTE_THREAD = 0,
    METHOD_APC_INJECTION,
    METHOD_SET_WINDOWS_HOOK,
    METHOD_REFLECTIVE_DLL,
    METHOD_PROCESS_HOLLOWING
};

// Injection result structure
struct InjectionResult {
    BOOL success;
    DWORD pid;
    std::string dllPath;
    InjectionMethod method;
    DWORD threadId;
    std::string error;
};

// Function declarations
InjectionResult InjectDll(DWORD pid, const std::string& dllPath, InjectionMethod method);
InjectionResult InjectCreateRemoteThread(DWORD pid, const std::string& dllPath);
InjectionResult InjectAPC(DWORD pid, const std::string& dllPath);
InjectionResult InjectSetWindowsHook(DWORD pid, const std::string& dllPath);
InjectionResult InjectReflectiveDLL(DWORD pid, const std::string& dllPath);
InjectionResult InjectProcessHollowing(DWORD pid, const std::string& dllPath);

// Helper functions
BOOL EnableDebugPrivilege();
std::string GetLastErrorString();
std::string InjectionResultToJSON(const InjectionResult& result);

#endif // INJECTION_METHODS_H