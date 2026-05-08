#include <windows.h>
#include <iostream>

/**
 * Creates a remote thread to load a monitoring DLL into another process.
 * Used by debugging tools for API monitoring and behavior analysis.
 * 
 * @param hProcess Handle from OpenProcess (requires PROCESS_CREATE_THREAD)
 * @param pRemoteDllPath LPVOID address containing DLL path from WriteProcessMemory
 * @return BOOL TRUE if successful, FALSE otherwise
 */
BOOL InjectMonitoringDll(HANDLE hProcess, LPVOID pRemoteDllPath) {
    // Validate parameters
    if (hProcess == NULL || hProcess == INVALID_HANDLE_VALUE) {
        std::cerr << "Invalid process handle" << std::endl;
        return FALSE;
    }
    
    if (pRemoteDllPath == NULL) {
        std::cerr << "Invalid remote DLL path address" << std::endl;
        return FALSE;
    }
    
    // Get address of LoadLibraryA in kernel32.dll
    HMODULE hKernel32 = GetModuleHandleA("kernel32.dll");
    if (hKernel32 == NULL) {
        std::cerr << "GetModuleHandleA failed: " << GetLastError() << std::endl;
        return FALSE;
    }
    
    FARPROC pLoadLibraryA = GetProcAddress(hKernel32, "LoadLibraryA");
    if (pLoadLibraryA == NULL) {
        std::cerr << "GetProcAddress failed: " << GetLastError() << std::endl;
        return FALSE;
    }
    
    // Create remote thread that calls LoadLibraryA with DLL path
    HANDLE hRemoteThread = CreateRemoteThread(
        hProcess,           // Handle to target process
        NULL,               // Default security attributes
        0,                  // Default stack size
        (LPTHREAD_START_ROUTINE)pLoadLibraryA, // LoadLibraryA address
        pRemoteDllPath,     // DLL path as parameter
        0,                  // Run immediately
        NULL                // Don't need thread ID
    );
    
    if (hRemoteThread == NULL) {
        std::cerr << "CreateRemoteThread failed: " << GetLastError() << std::endl;
        return FALSE;
    }
    
    std::cout << "Remote thread created successfully" << std::endl;
    
    // Wait for thread to complete (LoadLibraryA to finish)
    DWORD waitResult = WaitForSingleObject(hRemoteThread, 10000); // 10 second timeout
    if (waitResult == WAIT_OBJECT_0) {
        std::cout << "Remote thread completed successfully" << std::endl;
    } else if (waitResult == WAIT_TIMEOUT) {
        std::cerr << "Remote thread timeout after 10 seconds" << std::endl;
        CloseHandle(hRemoteThread);
        return FALSE;
    } else {
        std::cerr << "WaitForSingleObject failed: " << GetLastError() << std::endl;
        CloseHandle(hRemoteThread);
        return FALSE;
    }
    
    // Get thread exit code (DLL base address if successful)
    DWORD exitCode = 0;
    if (!GetExitCodeThread(hRemoteThread, &exitCode)) {
        std::cerr << "GetExitCodeThread failed: " << GetLastError() << std::endl;
    } else if (exitCode == 0) {
        std::cerr << "LoadLibraryA failed in remote process (exit code 0)" << std::endl;
    } else {
        std::cout << "Monitoring DLL loaded at address: 0x" << std::hex << exitCode << std::dec << std::endl;
    }
    
    // Clean up
    CloseHandle(hRemoteThread);
    return TRUE;
}

/**
 * Example usage in debugging context
 */
int main() {
    // Example: Inject into current process for testing
    HANDLE hCurrentProcess = GetCurrentProcess();
    
    // Simulate previously allocated memory with DLL path
    const char* monitoringDll = "C:\\Tools\\DebugMonitor.dll";
    SIZE_T dllPathSize = strlen(monitoringDll) + 1;
    
    LPVOID pRemoteMem = VirtualAllocEx(
        hCurrentProcess,
        NULL,
        dllPathSize,
        MEM_COMMIT | MEM_RESERVE,
        PAGE_READWRITE
    );
    
    if (pRemoteMem != NULL) {
        // Write DLL path (simulating WriteProcessMemory)
        SIZE_T bytesWritten = 0;
        WriteProcessMemory(hCurrentProcess, pRemoteMem, monitoringDll, dllPathSize, &bytesWritten);
        
        if (bytesWritten == dllPathSize) {
            // Create remote thread to load the DLL
            if (InjectMonitoringDll(hCurrentProcess, pRemoteMem)) {
                std::cout << "Monitoring DLL injection successful" << std::endl;
            }
        }
        
        VirtualFreeEx(hCurrentProcess, pRemoteMem, 0, MEM_RELEASE);
    }
    
    return 0;
}