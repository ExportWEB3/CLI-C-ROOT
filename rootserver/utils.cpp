#define _CRT_SECURE_NO_WARNINGS
#include "utils.h"
#include <iostream>
#include <string>
#include <cstring>
#include <strings.h>

DWORD FindProcessByName(const char* processName) {
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnapshot == INVALID_HANDLE_VALUE) {
        std::cerr << "CreateToolhelp32Snapshot failed: " << GetLastError() << std::endl;
        return 0;
    }

    PROCESSENTRY32 pe32;
    pe32.dwSize = sizeof(PROCESSENTRY32);

    if (!Process32First(hSnapshot, &pe32)) {
        std::cerr << "Process32First failed: " << GetLastError() << std::endl;
        CloseHandle(hSnapshot);
        return 0;
    }

    std::string targetName(processName);
    DWORD foundPid = 0;

    do {
        std::string currentName(pe32.szExeFile);
        if (strcasecmp(currentName.c_str(), targetName.c_str()) == 0) {
            foundPid = pe32.th32ProcessID;
            break;
        }
    } while (Process32Next(hSnapshot, &pe32));

    CloseHandle(hSnapshot);
    return foundPid;
}

BOOL GetSystemInfo(char* hostname, DWORD hostnameSize, char* username, DWORD usernameSize) {
    if (!hostname || !username || hostnameSize == 0 || usernameSize == 0) {
        SetLastError(ERROR_INVALID_PARAMETER);
        return FALSE;
    }

    hostname[0] = '\0';
    username[0] = '\0';

    DWORD hostLen = hostnameSize;
    if (!GetComputerNameA(hostname, &hostLen)) {
        return FALSE;
    }

    DWORD userLen = usernameSize;
    if (!GetUserNameA(username, &userLen)) {
        return FALSE;
    }

    return TRUE;
}
BOOL GetOSVersion(char* os_version, DWORD osSize) {
    if (!os_version || osSize == 0) return FALSE;
    HKEY hKey;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
        DWORD type = REG_SZ;
        DWORD size = osSize;
        if (RegQueryValueExA(hKey, "ProductName", NULL, &type, (LPBYTE)os_version, &size) != ERROR_SUCCESS) {
            strncpy(os_version, "Windows", osSize);
            os_version[osSize - 1] = '\0';
        }
        RegCloseKey(hKey);
    } else {
        strncpy(os_version, "Windows", osSize);
        os_version[osSize - 1] = '\0';
    }
    return TRUE;
}
