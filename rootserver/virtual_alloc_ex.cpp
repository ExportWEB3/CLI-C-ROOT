#include <windows.h>
#include <iostream>
#include <string>

/**
 * Allocates memory in another process using VirtualAllocEx.
 * This demonstrates cross-process memory allocation for debugging/injection.
 * 
 * @param hProcess Handle to target process (must have PROCESS_VM_OPERATION)
 * @param size Number of bytes to allocate
 * @param allocationType Type of allocation (MEM_COMMIT, MEM_RESERVE, etc.)
 * @param protection Memory protection flags (PAGE_READWRITE, etc.)
 * @return LPVOID Pointer to allocated memory in target process, or NULL on failure
 */
LPVOID AllocateMemoryInProcess(HANDLE hProcess, SIZE_T size, DWORD allocationType, DWORD protection) {
    // Validate process handle
    if (hProcess == NULL || hProcess == INVALID_HANDLE_VALUE) {
        std::cerr << "Invalid process handle" << std::endl;
        return NULL;
    }
    
    // Check process access rights
    DWORD dwFlags = 0;
    if (!GetHandleInformation(hProcess, &dwFlags)) {
        std::cerr << "Invalid process handle (GetHandleInformation failed): " << GetLastError() << std::endl;
        return NULL;
    }
    
    // Allocate memory in the target process
    LPVOID pRemoteMemory = VirtualAllocEx(
        hProcess,           // Handle to target process
        NULL,               // Let system decide allocation address
        size,               // Size to allocate in bytes
        allocationType,     // Allocation type (MEM_COMMIT | MEM_RESERVE)
        protection          // Memory protection (PAGE_READWRITE, etc.)
    );
    
    if (pRemoteMemory == NULL) {
        std::cerr << "VirtualAllocEx failed: " << GetLastError() << std::endl;
        return NULL;
    }
    
    std::cout << "Allocated " << size << " bytes at address: 0x" 
              << std::hex << pRemoteMemory << std::dec << std::endl;
    return pRemoteMemory;
}

/**
 * Frees memory allocated in another process using VirtualFreeEx.
 * 
 * @param hProcess Handle to target process
 * @param pRemoteMemory Pointer to memory to free (from VirtualAllocEx)
 * @param size Size of memory region (must be 0 for MEM_RELEASE)
 * @param freeType Free operation (MEM_RELEASE or MEM_DECOMMIT)
 * @return BOOL TRUE if successful, FALSE otherwise
 */
BOOL FreeMemoryInProcess(HANDLE hProcess, LPVOID pRemoteMemory, SIZE_T size, DWORD freeType) {
    if (pRemoteMemory == NULL) {
        std::cerr << "Invalid memory pointer" << std::endl;
        return FALSE;
    }
    
    BOOL bResult = VirtualFreeEx(
        hProcess,           // Handle to target process
        pRemoteMemory,      // Pointer to memory to free
        size,               // Size (must be 0 for MEM_RELEASE)
        freeType            // Free operation
    );
    
    if (!bResult) {
        std::cerr << "VirtualFreeEx failed: " << GetLastError() << std::endl;
        return FALSE;
    }
    
    std::cout << "Freed memory at address: 0x" << std::hex << pRemoteMemory << std::dec << std::endl;
    return TRUE;
}

/**
 * Example: Allocate memory in current process (self-injection demo)
 * This demonstrates the API usage without requiring another process handle.
 */
void DemonstrateSelfAllocation() {
    std::cout << "\n=== Demonstrating VirtualAllocEx in current process ===" << std::endl;
    
    // Get handle to current process
    HANDLE hCurrentProcess = GetCurrentProcess();
    
    // Allocate 4096 bytes (one page) with read/write permissions
    LPVOID pMemory = AllocateMemoryInProcess(
        hCurrentProcess,
        4096,                           // One page
        MEM_COMMIT | MEM_RESERVE,       // Commit and reserve
        PAGE_READWRITE                  // Read/write access
    );
    
    if (pMemory != NULL) {
        // Demonstrate we can use the memory
        std::string testData = "Hello from VirtualAllocEx!";
        SIZE_T bytesWritten = 0;
        
        // Write to the allocated memory (in our own process)
        memcpy(pMemory, testData.c_str(), testData.length() + 1);
        
        // Read it back
        char buffer[256] = {0};
        memcpy(buffer, pMemory, testData.length() + 1);
        std::cout << "Read back from allocated memory: " << buffer << std::endl;
        
        // Free the memory
        FreeMemoryInProcess(hCurrentProcess, pMemory, 0, MEM_RELEASE);
    }
}

/**
 * Helper function to open a process by PID for demonstration
 * Note: Requires appropriate privileges (DEBUG_PRIVILEGE for system processes)
 */
HANDLE OpenProcessForDemo(DWORD pid) {
    HANDLE hProcess = OpenProcess(
        PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_QUERY_INFORMATION,
        FALSE,      // Do not inherit handle
        pid         // Process ID
    );
    
    if (hProcess == NULL) {
        std::cerr << "OpenProcess failed for PID " << pid << ": " << GetLastError() << std::endl;
        std::cout << "Note: Try running as administrator for system processes" << std::endl;
    }
    
    return hProcess;
}

/**
 * Example usage in main function
 */
int main() {
    std::cout << "VirtualAllocEx Demonstration" << std::endl;
    std::cout << "============================" << std::endl;
    
    // Demonstration 1: Allocate in current process (always works)
    DemonstrateSelfAllocation();
    
    // Demonstration 2: Try to allocate in another process
    std::cout << "\n=== Demonstrating cross-process allocation ===" << std::endl;
    std::cout << "Enter a target PID (0 for current process): ";
    
    DWORD targetPid = 0;
    std::cin >> targetPid;
    
    if (targetPid == 0) {
        targetPid = GetCurrentProcessId();
    }
    
    HANDLE hTargetProcess = OpenProcessForDemo(targetPid);
    if (hTargetProcess != NULL) {
        // Allocate memory in target process
        LPVOID pRemoteMem = AllocateMemoryInProcess(
            hTargetProcess,
            1024,                           // 1KB
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE
        );
        
        if (pRemoteMem != NULL) {
            // In a real scenario, you would use WriteProcessMemory here
            std::cout << "Successfully allocated memory in process " << targetPid << std::endl;
            std::cout << "Use WriteProcessMemory to write data to this location" << std::endl;
            
            // Clean up
            FreeMemoryInProcess(hTargetProcess, pRemoteMem, 0, MEM_RELEASE);
        }
        
        CloseHandle(hTargetProcess);
    }
    
    return 0;
}