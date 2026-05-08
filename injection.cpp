// injection.cpp - DLL injection for debugging tools (FULLY FIXED)
#include "injection.h"
#include <stdio.h>

// Enable SeDebugPrivilege to allow access to other processes
BOOL EnableDebugPrivilege() {
    HANDLE hToken;
    TOKEN_PRIVILEGES tp;
    LUID luid;
    
    // Open current process token
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &hToken)) {
        printf("[!] OpenProcessToken failed: %lu\n", GetLastError());
        return FALSE;
    }
    
    // Lookup SeDebugPrivilege
    if (!LookupPrivilegeValueA(NULL, "SeDebugPrivilege", &luid)) {
        printf("[!] LookupPrivilegeValue failed: %lu\n", GetLastError());
        CloseHandle(hToken);
        return FALSE;
    }
    
    tp.PrivilegeCount = 1;
    tp.Privileges[0].Luid = luid;
    tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
    
    // Enable the privilege
    if (!AdjustTokenPrivileges(hToken, FALSE, &tp, sizeof(tp), NULL, NULL)) {
        printf("[!] AdjustTokenPrivileges failed: %lu\n", GetLastError());
        CloseHandle(hToken);
        return FALSE;
    }
    
    if (GetLastError() == ERROR_NOT_ALL_ASSIGNED) {
        printf("[!] SeDebugPrivilege not assigned. Run as Administrator?\n");
        CloseHandle(hToken);
        return FALSE;
    }
    
    printf("[+] SeDebugPrivilege enabled\n");
    CloseHandle(hToken);
    return TRUE;
}

BOOL InjectDllIntoProcess(DWORD pid, const char* dllPath) {
    // ALL declarations at the top (no goto crossing issues)
    HANDLE hProcess = NULL;
    LPVOID remoteMem = NULL;
    HANDLE hRemoteThread = NULL;
    HMODULE hKernel32 = NULL;
    FARPROC pLoadLibraryA = NULL;
    SIZE_T bytesWritten = 0;
    DWORD waitResult = 0;
    DWORD exitCode = 0;
    BOOL success = FALSE;
    size_t dllPathSize = 0;
    
    // Enable debug privilege for cross-process access
    EnableDebugPrivilege();
    
    // Early validation
    if (!dllPath || strlen(dllPath) == 0) {
        printf("[!] Invalid DLL path\n");
        return FALSE;
    }
    
    dllPathSize = strlen(dllPath) + 1;
    
    // 1. Open target process
    hProcess = OpenProcess(PROCESS_ALL_ACCESS, FALSE, pid);
    if (!hProcess) {
        printf("[!] OpenProcess failed for PID %lu. Error: %lu\n", pid, GetLastError());
        goto cleanup;
    }
    printf("[+] Opened process PID: %lu\n", pid);
    
    // 2. Allocate memory in target process
    remoteMem = VirtualAllocEx(hProcess, NULL, dllPathSize, MEM_COMMIT, PAGE_READWRITE);
    if (!remoteMem) {
        printf("[!] VirtualAllocEx failed. Error: %lu\n", GetLastError());
        goto cleanup;
    }
    printf("[+] Allocated memory at: %p\n", remoteMem);
    
    // 3. Write DLL path to target process
    if (!WriteProcessMemory(hProcess, remoteMem, dllPath, dllPathSize, &bytesWritten)) {
        printf("[!] WriteProcessMemory failed. Error: %lu\n", GetLastError());
        goto cleanup;
    }
    printf("[+] Wrote %zu bytes to target process\n", bytesWritten);
    
    // 4. Get LoadLibraryA address
    hKernel32 = GetModuleHandleA("kernel32.dll");
    if (!hKernel32) {
        printf("[!] GetModuleHandleA failed. Error: %lu\n", GetLastError());
        goto cleanup;
    }
    
    pLoadLibraryA = GetProcAddress(hKernel32, "LoadLibraryA");
    if (!pLoadLibraryA) {
        printf("[!] GetProcAddress failed. Error: %lu\n", GetLastError());
        goto cleanup;
    }
    printf("[+] LoadLibraryA address: %p\n", pLoadLibraryA);
    
    // 5. Create remote thread to load DLL
    hRemoteThread = CreateRemoteThread(hProcess, NULL, 0, 
                                       (LPTHREAD_START_ROUTINE)pLoadLibraryA, 
                                       remoteMem, 0, NULL);
    if (!hRemoteThread) {
        printf("[!] CreateRemoteThread failed. Error: %lu\n", GetLastError());
        goto cleanup;
    }
    printf("[+] Created remote thread\n");
    
    // 6. Wait for thread to complete
    waitResult = WaitForSingleObject(hRemoteThread, 10000);
    if (waitResult == WAIT_OBJECT_0) {
        if (GetExitCodeThread(hRemoteThread, &exitCode)) {
            if (exitCode) {
                printf("[+] DLL loaded successfully! Return value: %lu\n", exitCode);
                success = TRUE;
            } else {
                printf("[!] LoadLibraryA returned NULL - DLL may have failed to load\n");
            }
        }
    } else if (waitResult == WAIT_TIMEOUT) {
        printf("[!] Wait timed out after 10 seconds\n");
    } else {
        printf("[!] Wait failed. Error: %lu\n", GetLastError());
    }
    
cleanup:
    // Clean up handles
    if (hRemoteThread) {
        CloseHandle(hRemoteThread);
        hRemoteThread = NULL;
    }
    if (remoteMem && hProcess) {
        VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        remoteMem = NULL;
    }
    if (hProcess) {
        CloseHandle(hProcess);
        hProcess = NULL;
    }
    
    return success;
}