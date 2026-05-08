#ifndef FILE_BROWSER_H
#define FILE_BROWSER_H

#include <windows.h>
#include <string>
#include <vector>

struct FileInfo {
    std::string name;
    long long size;
    bool isDirectory;
    std::string lastModified;
    std::string permissions;
};

class FileBrowser {
public:
    // List directory contents
    static std::string ListDirectory(const char* path);
    
    // Get file information
    static FileInfo GetFileInfo(const char* filepath);
    
    // Check if path exists
    static bool PathExists(const char* path);
    
    // Create directory
    static bool CreateDirectory(const char* path);
    
    // Delete file or directory (single)
    static bool DeletePath(const char* path);
    
    // Recursive delete (directory + all contents)
    static bool DeleteRecursive(const char* path);
    
    // Get current working directory
    static std::string GetCurrentDirectory();
    
    // Change directory
    static bool ChangeDirectory(const char* path);
    
    // Get drives list
    static std::string GetDrives();
    
    // Rename file or directory
    static bool RenamePath(const char* oldPath, const char* newPath);
    
    // Copy file
    static bool CopyFile(const char* src, const char* dest);
    
    // Move file (same as rename across filesystem)
    static bool MoveFile(const char* src, const char* dest);
    
    // Search for files by name pattern (wildcard)
    static std::string SearchFiles(const char* rootPath, const char* pattern, int maxResults = 100);
    
    // Get detailed file properties as JSON
    static std::string GetFileProperties(const char* path);
    
    // Preview text file (first N lines)
    static std::string PreviewTextFile(const char* path, int maxLines = 50);
    
    // Get file permissions/attributes as string
    static std::string GetPermissionsString(const char* path);
    
    // Set file attributes
    static bool SetFileAttributes(const char* path, DWORD attrs);
    
    // Create empty file (touch)
    static bool CreateEmptyFile(const char* path);
    
    // Zip a file or directory
    static std::string ZipPath(const char* path, const char* outputZip = nullptr);
    
    // Unzip to a directory
    static bool UnzipTo(const char* zipPath, const char* outputDir);
    
    // Get file MIME type
    static std::string GetMimeType(const char* path);
    
    // Batch delete multiple paths
    static std::string BatchDelete(const std::vector<std::string>& paths);
    
    // Get directory size recursively
    static long long GetDirectorySize(const char* path);
    
private:
    static std::string FormatFileTime(FILETIME ft);
    static std::string GetFileAttributesString(DWORD attrs);
    static void SearchRecursive(const std::string& basePath, const std::string& pattern, 
                                 std::vector<std::string>& results, int maxResults);
    static bool WildcardMatch(const char* str, const char* pattern);
};

#endif // FILE_BROWSER_H
