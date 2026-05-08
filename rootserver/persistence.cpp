#include "persistence.h"
#include <iostream>
#include <string>

BOOL AddToStartup(const char* name, const char* path) {
    HKEY hKey = NULL;
    DWORD dwDisposition = 0;
    
    // Convert strings to wide char for Windows API
    std::wstring wName(name, name + strlen(name));
    std::wstring wPath(path, path + strlen(path));
    
    // Create or open the Run key
    LONG result = RegCreateKeyExW(
        HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        0,
        NULL,
        REG_OPTION_NON_VOLATILE,
        KEY_WRITE,
        NULL,
        &hKey,
        &dwDisposition
    );
    
    if (result != ERROR_SUCCESS) {
        std::cerr << "RegCreateKeyEx failed: " << result << std::endl;
        return FALSE;
    }
    
    // Set the value
    result = RegSetValueExW(
        hKey,
        wName.c_str(),
        0,
        REG_SZ,
        (const BYTE*)wPath.c_str(),
        (wPath.length() + 1) * sizeof(WCHAR)
    );
    
    RegCloseKey(hKey);
    
    if (result != ERROR_SUCCESS) {
        std::cerr << "RegSetValueEx failed: " << result << std::endl;
        return FALSE;
    }
    
    std::cout << "Added to startup: " << name << " -> " << path << std::endl;
    return TRUE;
}

BOOL RemoveFromStartup(const char* name) {
    HKEY hKey = NULL;
    
    // Convert string to wide char
    std::wstring wName(name, name + strlen(name));
    
    // Open the Run key
    LONG result = RegOpenKeyExW(
        HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        0,
        KEY_SET_VALUE,
        &hKey
    );
    
    if (result != ERROR_SUCCESS) {
        std::cerr << "RegOpenKeyEx failed: " << result << std::endl;
        return FALSE;
    }
    
    // Delete the value
    result = RegDeleteValueW(hKey, wName.c_str());
    
    RegCloseKey(hKey);
    
    if (result == ERROR_SUCCESS) {
        std::cout << "Removed from startup: " << name << std::endl;
        return TRUE;
    } else if (result == ERROR_FILE_NOT_FOUND) {
        std::cout << "Startup entry not found: " << name << std::endl;
        return TRUE; // Not an error if it doesn't exist
    } else {
        std::cerr << "RegDeleteValue failed: " << result << std::endl;
        return FALSE;
    }
}