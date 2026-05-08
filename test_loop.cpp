#include <windows.h>
#include <iostream>
typedef LONG NTSTATUS;
using pNtSuspendProcess = NTSTATUS(NTAPI *)(HANDLE);
using pNtResumeProcess = NTSTATUS(NTAPI *)(HANDLE);
int main() {
    HMODULE ntdll = LoadLibraryA("ntdll.dll");
    pNtSuspendProcess NtSuspendProcess = (pNtSuspendProcess)GetProcAddress(ntdll, "NtSuspendProcess");
    pNtResumeProcess NtResumeProcess = (pNtResumeProcess)GetProcAddress(ntdll, "NtResumeProcess");
    
    STARTUPINFOA si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    CreateProcessA("C:\\Windows\\System32\\notepad.exe", NULL, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi);
    Sleep(1000);
    
    std::cout << "Suspending 3 times...\n";
    NtSuspendProcess(pi.hProcess);
    NtSuspendProcess(pi.hProcess);
    NtSuspendProcess(pi.hProcess);
    
    std::cout << "Resuming in a loop...\n";
    for(int i=0; i<5; i++) {
        NTSTATUS st = NtResumeProcess(pi.hProcess);
        std::cout << "Resume " << i << " status: " << std::hex << st << std::endl;
    }
    
    TerminateProcess(pi.hProcess, 0);
    return 0;
}
