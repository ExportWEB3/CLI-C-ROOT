#include <windows.h>
#include <tlhelp32.h>
#include <iostream>

/**
 * Enumerates all running processes using CreateToolhelp32Snapshot.
 * This function demonstrates process enumeration for system administration.
 * 
 * @return BOOL TRUE if successful, FALSE otherwise
 */
BOOL EnumerateProcesses() {
    // Take a snapshot of all processes in the system
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnapshot == INVALID_HANDLE_VALUE) {
        std::cerr << "CreateToolhelp32Snapshot failed: " << GetLastError() << std::endl;
        return FALSE;
    }

    // Initialize process entry structure
    PROCESSENTRY32 pe32;
    pe32.dwSize = sizeof(PROCESSENTRY32);

    // Retrieve information about the first process
    if (!Process32First(hSnapshot, &pe32)) {
        std::cerr << "Process32First failed: " << GetLastError() << std::endl;
        CloseHandle(hSnapshot);
        return FALSE;
    }

    // Walk through the snapshot of processes
    std::cout << "Running processes:" << std::endl;
    std::cout << "PID\tProcess Name" << std::endl;
    std::cout << "---\t------------" << std::endl;

    do {
        // Print process ID and executable name
        std::cout << pe32.th32ProcessID << "\t" << pe32.szExeFile << std::endl;
    } while (Process32Next(hSnapshot, &pe32));

    // Clean up the snapshot object
    CloseHandle(hSnapshot);
    return TRUE;
}

/**
 * Example usage in main function
 */
int main() {
    if (!EnumerateProcesses()) {
        std::cerr << "Failed to enumerate processes" << std::endl;
        return 1;
    }
    return 0;
}