#include "file_browser.h"
#include <windows.h>
#include <shlwapi.h>
#include <sstream>
#include <iomanip>
#include <vector>
#include <algorithm>
#include <fstream>
#include <cctype>

#pragma comment(lib, "shlwapi.lib")

// Local JSON string escape helper
static std::string escapeJson(const std::string& input) {
    std::string output;
    output.reserve(input.length());
    for (char c : input) {
        switch (c) {
            case '"':  output += "\\\""; break;
            case '\\': output += "\\\\"; break;
            case '\n': output += "\\n"; break;
            case '\r': output += "\\r"; break;
            case '\t': output += "\\t"; break;
            default:   output += c;
        }
    }
    return output;
}

std::string FileBrowser::FormatFileTime(FILETIME ft) {
    SYSTEMTIME st;
    FileTimeToSystemTime(&ft, &st);
    
    char buffer[64];
    sprintf(buffer, "%04d-%02d-%02d %02d:%02d:%02d",
            st.wYear, st.wMonth, st.wDay,
            st.wHour, st.wMinute, st.wSecond);
    return std::string(buffer);
}

std::string FileBrowser::GetFileAttributesString(DWORD attrs) {
    std::string result;
    if (attrs & FILE_ATTRIBUTE_DIRECTORY) result += "D";
    if (attrs & FILE_ATTRIBUTE_READONLY) result += "R";
    if (attrs & FILE_ATTRIBUTE_HIDDEN) result += "H";
    if (attrs & FILE_ATTRIBUTE_SYSTEM) result += "S";
    if (attrs & FILE_ATTRIBUTE_ARCHIVE) result += "A";
    return result;
}

std::string FileBrowser::ListDirectory(const char* path) {
    std::string searchPath = path;
    if (searchPath.empty() || searchPath == ".") {
        char currentDir[MAX_PATH];
        ::GetCurrentDirectoryA(MAX_PATH, currentDir);
        searchPath = currentDir;
    }
    
    if (searchPath.back() != '\\') {
        searchPath += "\\";
    }
    searchPath += "*";
    
    WIN32_FIND_DATAA findData;
    HANDLE hFind = ::FindFirstFileA(searchPath.c_str(), &findData);
    
    if (hFind == INVALID_HANDLE_VALUE) {
        return "ERROR: Directory not found";
    }
    
    std::vector<FileInfo> files;
    
    do {
        // Skip . and .. entries
        if (strcmp(findData.cFileName, ".") == 0 || strcmp(findData.cFileName, "..") == 0) {
            continue;
        }
        
        FileInfo info;
        info.name = findData.cFileName;
        info.isDirectory = (findData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
        
        if (!info.isDirectory) {
            info.size = ((long long)findData.nFileSizeHigh << 32) | findData.nFileSizeLow;
        } else {
            info.size = 0;
        }
        
        info.lastModified = FormatFileTime(findData.ftLastWriteTime);
        info.permissions = GetFileAttributesString(findData.dwFileAttributes);
        
        files.push_back(info);
    } while (::FindNextFileA(hFind, &findData));
    
    ::FindClose(hFind);
    
    // Sort: directories first, then alphabetically
    std::sort(files.begin(), files.end(), [](const FileInfo& a, const FileInfo& b) {
        if (a.isDirectory != b.isDirectory) {
            return a.isDirectory > b.isDirectory; // Directories first
        }
        return a.name < b.name;
    });
    
    // Build JSON response
    std::stringstream json;
    json << "{\"path\":\"" << path << "\",\"files\":[";
    
    for (size_t i = 0; i < files.size(); i++) {
        const FileInfo& info = files[i];
        json << "{";
        json << "\"name\":\"" << info.name << "\",";
        json << "\"size\":" << info.size << ",";
        json << "\"isDirectory\":" << (info.isDirectory ? "true" : "false") << ",";
        json << "\"lastModified\":\"" << info.lastModified << "\",";
        json << "\"permissions\":\"" << info.permissions << "\"";
        json << "}";
        
        if (i < files.size() - 1) {
            json << ",";
        }
    }
    
    json << "]}";
    return json.str();
}

// ── New File Manager Functions ──

bool FileBrowser::CreateEmptyFile(const char* path) {
    HANDLE hFile = ::CreateFileA(path, GENERIC_WRITE, 0, NULL, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) {
        // Try CREATE_ALWAYS if file exists (touch behavior)
        hFile = ::CreateFileA(path, GENERIC_WRITE, 0, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
        if (hFile == INVALID_HANDLE_VALUE) return false;
        // Update last write time to now
        SYSTEMTIME st;
        GetSystemTime(&st);
        FILETIME ft;
        SystemTimeToFileTime(&st, &ft);
        ::SetFileTime(hFile, NULL, NULL, &ft);
        ::CloseHandle(hFile);
        return true;
    }
    ::CloseHandle(hFile);
    return true;
}

std::string FileBrowser::ZipPath(const char* path, const char* outputZip) {
    // Use PowerShell's Compress-Archive (available on Win10+)
    std::string psCmd = "powershell -NoProfile -Command \"";
    psCmd += "Compress-Archive -Path '";
    psCmd += path;
    psCmd += "' -DestinationPath '";
    if (outputZip && strlen(outputZip) > 0) {
        psCmd += outputZip;
    } else {
        psCmd += path;
        psCmd += ".zip";
    }
    psCmd += "' -Force 2>&1\"";
    
    // Execute via pipe
    std::string result;
    FILE* pipe = _popen(psCmd.c_str(), "r");
    if (pipe) {
        char buffer[256];
        while (fgets(buffer, sizeof(buffer), pipe)) {
            result += buffer;
        }
        int exitCode = _pclose(pipe);
        
        std::stringstream json;
        json << "{\"success\":";
        json << (exitCode == 0 ? "true" : "false");
        json << ",\"output\":\"" << escapeJson(result) << "\"";
        if (exitCode == 0) {
            std::string zipPath = std::string(path) + ".zip";
            json << ",\"zipPath\":\"" << zipPath << "\"";
        }
        json << "}";
        return json.str();
    }
    return "{\"success\":false,\"output\":\"Failed to execute zip command\"}";
}

bool FileBrowser::UnzipTo(const char* zipPath, const char* outputDir) {
    // Use PowerShell's Expand-Archive
    std::string psCmd = "powershell -NoProfile -Command \"";
    psCmd += "Expand-Archive -Path '";
    psCmd += zipPath;
    psCmd += "' -DestinationPath '";
    psCmd += outputDir;
    psCmd += "' -Force 2>&1\"";
    
    FILE* pipe = _popen(psCmd.c_str(), "r");
    if (pipe) {
        int exitCode = _pclose(pipe);
        return exitCode == 0;
    }
    return false;
}

std::string FileBrowser::GetMimeType(const char* path) {
    // Simple MIME type detection by extension
    const char* ext = strrchr(path, '.');
    if (!ext) return "application/octet-stream";
    
    // Convert to lowercase
    std::string extLower = ext;
    for (auto& c : extLower) c = tolower(c);
    
    if (extLower == ".txt") return "text/plain";
    if (extLower == ".html" || extLower == ".htm") return "text/html";
    if (extLower == ".css") return "text/css";
    if (extLower == ".js") return "application/javascript";
    if (extLower == ".json") return "application/json";
    if (extLower == ".xml") return "application/xml";
    if (extLower == ".pdf") return "application/pdf";
    if (extLower == ".png") return "image/png";
    if (extLower == ".jpg" || extLower == ".jpeg") return "image/jpeg";
    if (extLower == ".gif") return "image/gif";
    if (extLower == ".bmp") return "image/bmp";
    if (extLower == ".svg") return "image/svg+xml";
    if (extLower == ".ico") return "image/x-icon";
    if (extLower == ".mp4") return "video/mp4";
    if (extLower == ".mp3") return "audio/mpeg";
    if (extLower == ".wav") return "audio/wav";
    if (extLower == ".zip") return "application/zip";
    if (extLower == ".rar") return "application/vnd.rar";
    if (extLower == ".7z") return "application/x-7z-compressed";
    if (extLower == ".tar") return "application/x-tar";
    if (extLower == ".gz") return "application/gzip";
    if (extLower == ".exe") return "application/x-msdownload";
    if (extLower == ".dll") return "application/x-msdownload";
    if (extLower == ".doc" || extLower == ".docx") return "application/msword";
    if (extLower == ".xls" || extLower == ".xlsx") return "application/vnd.ms-excel";
    if (extLower == ".ppt" || extLower == ".pptx") return "application/vnd.ms-powerpoint";
    if (extLower == ".csv") return "text/csv";
    if (extLower == ".py") return "text/x-python";
    if (extLower == ".cpp" || extLower == ".c" || extLower == ".h") return "text/x-c++src";
    
    return "application/octet-stream";
}

std::string FileBrowser::BatchDelete(const std::vector<std::string>& paths) {
    std::stringstream json;
    json << "{\"results\":[";
    
    for (size_t i = 0; i < paths.size(); i++) {
        if (i > 0) json << ",";
        
        DWORD attrs = ::GetFileAttributesA(paths[i].c_str());
        bool success = false;
        std::string errorMsg;
        
        if (attrs == INVALID_FILE_ATTRIBUTES) {
            errorMsg = "Path not found";
        } else if (attrs & FILE_ATTRIBUTE_DIRECTORY) {
            success = DeleteRecursive(paths[i].c_str());
            if (!success) errorMsg = "Failed to delete directory";
        } else {
            success = ::DeleteFileA(paths[i].c_str()) != 0;
            if (!success) errorMsg = "Failed to delete file";
        }
        
        json << "{\"path\":\"" << paths[i] << "\",";
        json << "\"success\":" << (success ? "true" : "false");
        if (!errorMsg.empty()) {
            json << ",\"error\":\"" << errorMsg << "\"";
        }
        json << "}";
    }
    
    json << "]}";
    return json.str();
}

long long FileBrowser::GetDirectorySize(const char* path) {
    long long totalSize = 0;
    std::string searchPath = path;
    if (searchPath.back() != '\\') searchPath += "\\";
    searchPath += "*";
    
    WIN32_FIND_DATAA findData;
    HANDLE hFind = ::FindFirstFileA(searchPath.c_str(), &findData);
    if (hFind == INVALID_HANDLE_VALUE) return 0;
    
    do {
        if (strcmp(findData.cFileName, ".") == 0 || strcmp(findData.cFileName, "..") == 0) {
            continue;
        }
        
        std::string fullPath = std::string(path) + "\\" + findData.cFileName;
        
        if (findData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            totalSize += GetDirectorySize(fullPath.c_str());
        } else {
            totalSize += ((long long)findData.nFileSizeHigh << 32) | findData.nFileSizeLow;
        }
    } while (::FindNextFileA(hFind, &findData));
    
    ::FindClose(hFind);
    return totalSize;
}

bool FileBrowser::DeleteRecursive(const char* path) {
    DWORD attrs = ::GetFileAttributesA(path);
    if (attrs == INVALID_FILE_ATTRIBUTES) {
        return false;
    }
    
    if (!(attrs & FILE_ATTRIBUTE_DIRECTORY)) {
        return ::DeleteFileA(path) != 0;
    }
    
    // It's a directory - enumerate and delete all contents first
    std::string searchPath = path;
    if (searchPath.back() != '\\') searchPath += "\\";
    searchPath += "*";
    
    WIN32_FIND_DATAA findData;
    HANDLE hFind = ::FindFirstFileA(searchPath.c_str(), &findData);
    if (hFind == INVALID_HANDLE_VALUE) {
        return false;
    }
    
    do {
        if (strcmp(findData.cFileName, ".") == 0 || strcmp(findData.cFileName, "..") == 0) {
            continue;
        }
        std::string fullPath = std::string(path) + "\\" + findData.cFileName;
        if (!DeleteRecursive(fullPath.c_str())) {
            ::FindClose(hFind);
            return false;
        }
    } while (::FindNextFileA(hFind, &findData));
    
    ::FindClose(hFind);
    
    // Now remove the empty directory
    return ::RemoveDirectoryA(path) != 0;
}

bool FileBrowser::RenamePath(const char* oldPath, const char* newPath) {
    return ::MoveFileExA(oldPath, newPath, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != 0;
}

bool FileBrowser::CopyFile(const char* src, const char* dest) {
    return ::CopyFileA(src, dest, FALSE) != 0;
}

bool FileBrowser::MoveFile(const char* src, const char* dest) {
    return ::MoveFileExA(src, dest, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != 0;
}

bool FileBrowser::WildcardMatch(const char* str, const char* pattern) {
    // Simple wildcard matching: * matches any sequence, ? matches single char
    while (*pattern) {
        if (*pattern == '*') {
            pattern++;
            if (*pattern == '\0') return true;
            while (*str) {
                if (WildcardMatch(str, pattern)) return true;
                str++;
            }
            return false;
        } else if (*pattern == '?') {
            if (*str == '\0') return false;
            str++;
            pattern++;
        } else {
            if (tolower(*str) != tolower(*pattern)) return false;
            str++;
            pattern++;
        }
    }
    return *str == '\0';
}

void FileBrowser::SearchRecursive(const std::string& basePath, const std::string& pattern,
                                    std::vector<std::string>& results, int maxResults) {
    if ((int)results.size() >= maxResults) return;
    
    std::string searchPath = basePath;
    if (searchPath.back() != '\\') searchPath += "\\";
    searchPath += "*";
    
    WIN32_FIND_DATAA findData;
    HANDLE hFind = ::FindFirstFileA(searchPath.c_str(), &findData);
    if (hFind == INVALID_HANDLE_VALUE) return;
    
    do {
        if (strcmp(findData.cFileName, ".") == 0 || strcmp(findData.cFileName, "..") == 0) {
            continue;
        }
        
        std::string fullPath = basePath + "\\" + findData.cFileName;
        
        // Check if name matches pattern
        if (WildcardMatch(findData.cFileName, pattern.c_str())) {
            results.push_back(fullPath);
            if ((int)results.size() >= maxResults) {
                ::FindClose(hFind);
                return;
            }
        }
        
        // Recurse into directories
        if (findData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            SearchRecursive(fullPath, pattern, results, maxResults);
            if ((int)results.size() >= maxResults) {
                ::FindClose(hFind);
                return;
            }
        }
    } while (::FindNextFileA(hFind, &findData));
    
    ::FindClose(hFind);
}

std::string FileBrowser::SearchFiles(const char* rootPath, const char* pattern, int maxResults) {
    std::vector<std::string> results;
    SearchRecursive(rootPath, pattern, results, maxResults);
    
    std::stringstream json;
    json << "{\"root\":\"" << rootPath << "\",\"pattern\":\"" << pattern << "\",\"results\":[";
    for (size_t i = 0; i < results.size(); i++) {
        if (i > 0) json << ",";
        json << "\"" << results[i] << "\"";
    }
    json << "],\"count\":" << results.size() << "}";
    return json.str();
}

std::string FileBrowser::GetFileProperties(const char* path) {
    WIN32_FILE_ATTRIBUTE_DATA fileData;
    if (!::GetFileAttributesExA(path, GetFileExInfoStandard, &fileData)) {
        return "{\"error\":\"File not found\"}";
    }
    
    bool isDir = (fileData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
    long long fileSize = ((long long)fileData.nFileSizeHigh << 32) | fileData.nFileSizeLow;
    
    // Get file owner
    char owner[256] = "Unknown";
    PSID pSid = NULL;
    PSECURITY_DESCRIPTOR pSD = NULL;
    DWORD sdSize = GetFileSecurityA(path, OWNER_SECURITY_INFORMATION, NULL, 0, &sdSize);
    if (GetLastError() == ERROR_INSUFFICIENT_BUFFER && sdSize > 0) {
        pSD = (PSECURITY_DESCRIPTOR)malloc(sdSize);
        if (GetFileSecurityA(path, OWNER_SECURITY_INFORMATION, pSD, sdSize, &sdSize)) {
            BOOL defaulted = FALSE;
            if (GetSecurityDescriptorOwner(pSD, &pSid, &defaulted) && pSid) {
                char name[256], domain[256];
                DWORD nameLen = 256, domainLen = 256;
                SID_NAME_USE sidType;
                if (LookupAccountSidA(NULL, pSid, name, &nameLen, domain, &domainLen, &sidType)) {
                    snprintf(owner, sizeof(owner), "%s\\%s", domain, name);
                }
            }
        }
        free(pSD);
    }
    
    // Get creation, access times
    std::string created = FormatFileTime(fileData.ftCreationTime);
    std::string modified = FormatFileTime(fileData.ftLastWriteTime);
    std::string accessed = FormatFileTime(fileData.ftLastAccessTime);
    
    std::stringstream json;
    json << "{";
    json << "\"path\":\"" << path << "\",";
    json << "\"name\":\"" << ::PathFindFileNameA(path) << "\",";
    json << "\"isDirectory\":" << (isDir ? "true" : "false") << ",";
    json << "\"size\":" << fileSize << ",";
    json << "\"created\":\"" << created << "\",";
    json << "\"modified\":\"" << modified << "\",";
    json << "\"accessed\":\"" << accessed << "\",";
    json << "\"owner\":\"" << owner << "\",";
    json << "\"attributes\":\"" << GetFileAttributesString(fileData.dwFileAttributes) << "\",";
    json << "\"hidden\":" << ((fileData.dwFileAttributes & FILE_ATTRIBUTE_HIDDEN) ? "true" : "false") << ",";
    json << "\"readonly\":" << ((fileData.dwFileAttributes & FILE_ATTRIBUTE_READONLY) ? "true" : "false") << ",";
    json << "\"system\":" << ((fileData.dwFileAttributes & FILE_ATTRIBUTE_SYSTEM) ? "true" : "false");
    json << "}";
    return json.str();
}

std::string FileBrowser::PreviewTextFile(const char* path, int maxLines) {
    std::ifstream file(path);
    if (!file.is_open()) {
        return "{\"error\":\"Cannot open file\"}";
    }
    
    std::stringstream result;
    std::string line;
    int lineCount = 0;
    long long totalSize = 0;
    
    // Check file size first (limit to 1MB preview)
    WIN32_FILE_ATTRIBUTE_DATA fad;
    if (::GetFileAttributesExA(path, GetFileExInfoStandard, &fad)) {
        totalSize = ((long long)fad.nFileSizeHigh << 32) | fad.nFileSizeLow;
    }
    
    if (totalSize > 1024 * 1024) {
        return "{\"error\":\"File too large for preview (>1MB)\",\"size\":" + std::to_string(totalSize) + "}";
    }
    
    result << "{\"path\":\"" << path << "\",\"totalSize\":" << totalSize << ",\"lines\":[";
    
    bool first = true;
    while (std::getline(file, line) && lineCount < maxLines) {
        if (!first) result << ",";
        first = false;
        
        // Escape JSON special characters
        std::string escaped;
        for (char c : line) {
            switch (c) {
                case '"': escaped += "\\\""; break;
                case '\\': escaped += "\\\\"; break;
                case '\n': escaped += "\\n"; break;
                case '\r': escaped += "\\r"; break;
                case '\t': escaped += "\\t"; break;
                default: escaped += c;
            }
        }
        result << "\"" << escaped << "\"";
        lineCount++;
    }
    
    result << "],\"lineCount\":" << lineCount << ",\"truncated\":" << (file.eof() ? "false" : "true") << "}";
    return result.str();
}

std::string FileBrowser::GetPermissionsString(const char* path) {
    DWORD attrs = ::GetFileAttributesA(path);
    if (attrs == INVALID_FILE_ATTRIBUTES) {
        return "ERROR: Path not found";
    }
    return GetFileAttributesString(attrs);
}

bool FileBrowser::SetFileAttributes(const char* path, DWORD attrs) {
    return ::SetFileAttributesA(path, attrs) != 0;
}

FileInfo FileBrowser::GetFileInfo(const char* filepath) {
    FileInfo info;
    WIN32_FILE_ATTRIBUTE_DATA fileData;
    
    if (::GetFileAttributesExA(filepath, GetFileExInfoStandard, &fileData)) {
        info.name = ::PathFindFileNameA(filepath);
        info.isDirectory = (fileData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
        
        if (!info.isDirectory) {
            info.size = ((long long)fileData.nFileSizeHigh << 32) | fileData.nFileSizeLow;
        } else {
            info.size = 0;
        }
        
        info.lastModified = FormatFileTime(fileData.ftLastWriteTime);
        info.permissions = GetFileAttributesString(fileData.dwFileAttributes);
    }
    
    return info;
}

bool FileBrowser::PathExists(const char* path) {
    DWORD attrs = ::GetFileAttributesA(path);
    return (attrs != INVALID_FILE_ATTRIBUTES);
}

bool FileBrowser::CreateDirectory(const char* path) {
    return ::CreateDirectoryA(path, NULL) != 0;
}

bool FileBrowser::DeletePath(const char* path) {
    DWORD attrs = ::GetFileAttributesA(path);
    if (attrs == INVALID_FILE_ATTRIBUTES) {
        return false;
    }
    
    if (attrs & FILE_ATTRIBUTE_DIRECTORY) {
        // Remove directory
        return ::RemoveDirectoryA(path) != 0;
    } else {
        // Delete file
        return ::DeleteFileA(path) != 0;
    }
}

std::string FileBrowser::GetCurrentDirectory() {
    char buffer[MAX_PATH];
    ::GetCurrentDirectoryA(MAX_PATH, buffer);
    return std::string(buffer);
}

bool FileBrowser::ChangeDirectory(const char* path) {
    return ::SetCurrentDirectoryA(path) != 0;
}

std::string FileBrowser::GetDrives() {
    std::stringstream json;
    json << "{\"drives\":[";
    
    DWORD drives = ::GetLogicalDrives();
    bool first = true;
    
    for (char drive = 'A'; drive <= 'Z'; drive++) {
        if (drives & 1) {
            std::string drivePath = std::string(1, drive) + ":\\";
            UINT type = ::GetDriveTypeA(drivePath.c_str());
            
            if (!first) {
                json << ",";
            }
            first = false;
            
            json << "{";
            json << "\"letter\":\"" << drive << ":\",";
            json << "\"type\":" << type << ",";
            
            // Get drive info if available
            char volumeName[MAX_PATH];
            char fileSystem[MAX_PATH];
            DWORD serialNumber, maxComponentLength, fileSystemFlags;
            
            if (::GetVolumeInformationA(drivePath.c_str(), volumeName, MAX_PATH,
                                     &serialNumber, &maxComponentLength,
                                     &fileSystemFlags, fileSystem, MAX_PATH)) {
                json << "\"volumeName\":\"" << volumeName << "\",";
                json << "\"fileSystem\":\"" << fileSystem << "\",";
                
                ULARGE_INTEGER freeBytes, totalBytes;
                if (::GetDiskFreeSpaceExA(drivePath.c_str(), &freeBytes, &totalBytes, NULL)) {
                    json << "\"totalBytes\":" << totalBytes.QuadPart << ",";
                    json << "\"freeBytes\":" << freeBytes.QuadPart;
                } else {
                    json << "\"totalBytes\":0,\"freeBytes\":0";
                }
            } else {
                json << "\"volumeName\":\"\",\"fileSystem\":\"\",";
                json << "\"totalBytes\":0,\"freeBytes\":0";
            }
            
            json << "}";
        }
        drives >>= 1;
    }
    
    json << "]}";
    return json.str();
}