#include <windows.h>
#include <iostream>
typedef LONG NTSTATUS;
using pNtSuspendProcess = NTSTATUS(NTAPI *)(HANDLE);
using pNtResumeProcess = NTSTATUS(NTAPI *)(HANDLE);

int main(int argc, char* argv[]) {
    if (argc < 3) return 1;
    DWORD pid = atoi(argv[2]);
    HMODULE ntdll = LoadLibraryA("ntdll.dll");
    pNtSuspendProcess NtSuspendProcess = (pNtSuspendProcess)GetProcAddress(ntdll, "NtSuspendProcess");
    pNtResumeProcess NtResumeProcess = (pNtResumeProcess)GetProcAddress(ntdll, "NtResumeProcess");
    HANDLE hProc = OpenProcess(PROCESS_SUSPEND_RESUME, FALSE, pid);
    if (!hProc) { std::cout << "OpenProcess failed\n"; return 1; }
    if (strcmp(argv[1], "suspend") == 0) {
        NTSTATUS st = NtSuspendProcess(hProc);
        std::cout << "Suspend status: " << std::hex << st << "\n";
    } else {
        NTSTATUS st = NtResumeProcess(hProc);
        std::cout << "Resume status: " << std::hex << st << "\n";
    }
    CloseHandle(hProc);
    return 0;
}
