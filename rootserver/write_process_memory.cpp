#include <windows.h>
#include <iostream>

/**
 * Writes a DLL path string to allocated memory in a remote process.
 * Used by debugging tools to inject helper DLL for API monitoring.
 * 
 * @param hProcess Handle from OpenProcess (requires PROCESS_VM_WRITE)
 * @param pRemoteAddress LPVOID address from VirtualAllocEx in target process
 * @param dllPath Full path to DLL as null-terminated string
 * @return BOOL TRUE if successful, FALSE otherwise
 */
BOOL WriteDllPathToProcess(HANDLE hProcess, LPVOID pRemoteAddress, LPCSTR dllPath) {
    // Validate parameters
    if (hProcess == NULL || hProcess == INVALID_HANDLE_VALUE) {
        std::cerr << "Invalid process handle" << std::endl;
        return FALSE;
    }
    
    if (pRemoteAddress == NULL) {
        std::cerr << "Invalid remote address" << std::endl;
        return FALSE;
    }
    
    if (dllPath == NULL || strlen(dllPath) == 0) {
        std::cerr << "Invalid DLL path" << std::endl;
        return FALSE;
    }
    
    // Calculate size including null terminator
    SIZE_T dataSize = strlen(dllPath) + 1;
    
    // Write DLL path to remote process memory
    SIZE_T bytesWritten = 0;
    BOOL success = WriteProcessMemory(
        hProcess,           // Handle to target process
        pRemoteAddress,     // Address in target process
        dllPath,            // Local buffer with DLL path
        dataSize,           // Number of bytes to write
        &bytesWritten       // Receives number of bytes written
    );
    
    if (!success) {
        DWORD error = GetLastError();
        std::cerr << "WriteProcessMemory failed: " << error << std::endl;
        return FALSE;
    }
    
    if (bytesWritten != dataSize) {
        std::cerr << "Partial write: " << bytesWritten << " of " << dataSize << " bytes" << std::endl;
        return FALSE;
    }
    
    std::cout << "Successfully wrote " << bytesWritten << " bytes to remote process" << std::endl;
    std::cout << "DLL path written: " << dllPath << std::endl;
    return TRUE;
}

/**
 * Example usage in debugging context
 */
int main() {
    // Example: Writing to current process for testing
    HANDLE hCurrentProcess = GetCurrentProcess();
    
    // First allocate memory in target (using VirtualAllocEx from previous example)
    LPVOID pRemoteMem = VirtualAllocEx(
        hCurrentProcess,
        NULL,
        MAX_PATH,
        MEM_COMMIT | MEM_RESERVE,
        PAGE_READWRITE
    );
    
    if (pRemoteMem != NULL) {
        // Write a DLL path for API monitoring
        const char* monitoringDll = "C:\\Tools\\DebugMonitor.dll";
        
        if (WriteDllPathToProcess(hCurrentProcess, pRemoteMem, monitoringDll)) {
            std::cout << "Debug helper DLL path injected successfully" << std::endl;
        }
        
        // Clean up
        VirtualFreeEx(hCurrentProcess, pRemoteMem, 0, MEM_RELEASE);
    }
    
    return 0;
}