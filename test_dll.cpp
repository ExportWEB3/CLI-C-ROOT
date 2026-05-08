#include <windows.h>

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID lpReserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        MessageBoxA(NULL, "Debug DLL loaded successfully!", "Debug Tool", MB_OK);
    }
    return TRUE;
}
