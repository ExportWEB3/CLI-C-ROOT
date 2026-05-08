// injection.h
#ifndef INJECTION_H
#define INJECTION_H

#include <windows.h>
#include <string.h>

BOOL EnableDebugPrivilege();
BOOL InjectDllIntoProcess(DWORD pid, const char* dllPath);

#endif