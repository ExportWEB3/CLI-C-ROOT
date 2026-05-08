#include <windows.h>
#include <iostream>

/**
 * Cleanup function for uninstalling a startup utility.
 * Removes registry persistence from Windows Run key.
 * 
 * @param valueName Name of the value to delete from startup
 * @return BOOL TRUE if successful, FALSE otherwise
 */
BOOL RemoveStartupEntry(LPCWSTR valueName) {
    HKEY hKey = NULL;
    
    // Open the Windows Run key for writing
    LONG result = RegOpenKeyExW(
        HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        0,
        KEY_SET_VALUE,
        &hKey
    );
    
    if (result != ERROR_SUCCESS) {
        std::wcerr << L"RegOpenKeyEx failed: " << result << std::endl;
        return FALSE;
    }
    
    // Delete the specified value from the registry
    result = RegDeleteValueW(hKey, valueName);
    
    if (result == ERROR_SUCCESS) {
        std::wcout << L"Successfully removed startup entry: " << valueName << std::endl;
    } else if (result == ERROR_FILE_NOT_FOUND) {
        std::wcout << L"Startup entry not found: " << valueName << std::endl;
    } else {
        std::wcerr << L"RegDeleteValue failed: " << result << std::endl;
        RegCloseKey(hKey);
        return FALSE;
    }
    
    // Close the registry key
    RegCloseKey(hKey);
    return TRUE;
}

/**
 * Example usage
 */
int main() {
    // Remove a hypothetical debugging tool from startup
    if (RemoveStartupEntry(L"DebugMonitor")) {
        std::wcout << L"Cleanup completed successfully" << std::endl;
    } else {
        std::wcerr << L"Cleanup failed" << std::endl;
    }
    
    return 0;
}