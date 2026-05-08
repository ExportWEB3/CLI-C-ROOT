#include <windows.h>
#include <iostream>

/**
 * Creates or opens a registry key and sets a string value.
 * Demonstrates registry operations for system configuration management.
 * 
 * @param hKeyRoot Parent key (e.g., HKEY_CURRENT_USER)
 * @param subKeyPath Path to the subkey
 * @param valueName Name of the value to set
 * @param valueData String data to write
 * @return BOOL TRUE if successful, FALSE otherwise
 */
BOOL WriteRegistryString(HKEY hKeyRoot, LPCWSTR subKeyPath, LPCWSTR valueName, LPCWSTR valueData) {
    HKEY hKey = NULL;
    DWORD dwDisposition = 0;
    
    // Create or open the registry key
    LONG lResult = RegCreateKeyExW(
        hKeyRoot,           // Root key handle
        subKeyPath,         // Subkey path
        0,                  // Reserved, must be 0
        NULL,               // Class type (not used)
        REG_OPTION_NON_VOLATILE, // Key persists after reboot
        KEY_WRITE,          // Desired access rights
        NULL,               // Security attributes
        &hKey,              // Receives opened key handle
        &dwDisposition      // Receives disposition (created/existed)
    );
    
    if (lResult != ERROR_SUCCESS) {
        std::wcerr << L"RegCreateKeyEx failed: " << lResult << std::endl;
        return FALSE;
    }
    
    // Set the string value in the registry
    lResult = RegSetValueExW(
        hKey,               // Handle to open key
        valueName,          // Name of value to set
        0,                  // Reserved, must be 0
        REG_SZ,             // Value type: null-terminated string
        (const BYTE*)valueData, // Data to write
        (wcslen(valueData) + 1) * sizeof(WCHAR) // Data size in bytes
    );
    
    if (lResult != ERROR_SUCCESS) {
        std::wcerr << L"RegSetValueEx failed: " << lResult << std::endl;
        RegCloseKey(hKey);
        return FALSE;
    }
    
    // Report what happened
    if (dwDisposition == REG_CREATED_NEW_KEY) {
        std::wcout << L"Created new key and set value" << std::endl;
    } else {
        std::wcout << L"Opened existing key and updated value" << std::endl;
    }
    
    // Clean up
    RegCloseKey(hKey);
    return TRUE;
}

/**
 * Reads a string value from the registry.
 * 
 * @param hKeyRoot Parent key (e.g., HKEY_CURRENT_USER)
 * @param subKeyPath Path to the subkey
 * @param valueName Name of the value to read
 * @param buffer Buffer to receive the string
 * @param bufferSize Size of buffer in characters
 * @return BOOL TRUE if successful, FALSE otherwise
 */
BOOL ReadRegistryString(HKEY hKeyRoot, LPCWSTR subKeyPath, LPCWSTR valueName, 
                       LPWSTR buffer, DWORD bufferSize) {
    HKEY hKey = NULL;
    
    // Open the registry key for reading
    LONG lResult = RegOpenKeyExW(
        hKeyRoot,           // Root key handle
        subKeyPath,         // Subkey path
        0,                  // Reserved, must be 0
        KEY_READ,           // Desired access rights
        &hKey               // Receives opened key handle
    );
    
    if (lResult != ERROR_SUCCESS) {
        std::wcerr << L"RegOpenKeyEx failed: " << lResult << std::endl;
        return FALSE;
    }
    
    // Read the string value from registry
    DWORD dwType = 0;
    DWORD dwDataSize = bufferSize * sizeof(WCHAR);
    
    lResult = RegQueryValueExW(
        hKey,               // Handle to open key
        valueName,          // Name of value to read
        NULL,               // Reserved, must be NULL
        &dwType,            // Receives value type
        (LPBYTE)buffer,     // Buffer for data
        &dwDataSize         // Size of buffer (in/out)
    );
    
    RegCloseKey(hKey);
    
    if (lResult != ERROR_SUCCESS) {
        std::wcerr << L"RegQueryValueEx failed: " << lResult << std::endl;
        return FALSE;
    }
    
    if (dwType != REG_SZ) {
        std::wcerr << L"Registry value is not a string (type: " << dwType << L")" << std::endl;
        return FALSE;
    }
    
    return TRUE;
}

/**
 * Example usage in main function
 */
int main() {
    // Example: Store application configuration
    if (!WriteRegistryString(
        HKEY_CURRENT_USER,
        L"Software\\MyApp\\Settings",
        L"InstallPath",
        L"C:\\Program Files\\MyApp"
    )) {
        std::wcerr << L"Failed to write registry value" << std::endl;
        return 1;
    }
    
    // Example: Read back the value
    WCHAR buffer[MAX_PATH] = {0};
    if (ReadRegistryString(
        HKEY_CURRENT_USER,
        L"Software\\MyApp\\Settings",
        L"InstallPath",
        buffer,
        MAX_PATH
    )) {
        std::wcout << L"Read value: " << buffer << std::endl;
    }
    
    return 0;
}