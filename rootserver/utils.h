#ifndef UTILS_H
#define UTILS_H

#include <windows.h>
#include <tlhelp32.h>
#include <string>

/**
 * Finds a process ID by its executable name using CreateToolhelp32Snapshot.
 * Used by system administration tools to locate specific processes.
 * 
 * @param processName Name of the process executable (e.g., "explorer.exe")
 * @return DWORD Process ID if found, 0 if not found
 */
DWORD FindProcessByName(const char* processName);
BOOL GetSystemInfo(char* hostname, DWORD hostnameSize, char* username, DWORD usernameSize);
BOOL GetOSVersion(char* os_version, DWORD osSize);

#endif // UTILS_H