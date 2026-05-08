// file_download.cpp - Complete file receiver (YOU write this)
#include <winsock2.h>
#include <windows.h>
#include <ws2tcpip.h>
#include <vector>
#include <string>
#include <stdint.h>
#include <algorithm>

#pragma comment(lib, "ws2_32.lib")

// ============ YOUR EXISTING FUNCTIONS ============

BOOL SaveBufferToFile(const char* path, const BYTE* data, DWORD dataSize) {
    if (!path || !data) return FALSE;
    
    HANDLE hFile = CreateFileA(path, GENERIC_WRITE, FILE_SHARE_READ, NULL,
                                CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return FALSE;
    
    DWORD totalWritten = 0;
    while (totalWritten < dataSize) {
        DWORD written = 0;
        if (!WriteFile(hFile, data + totalWritten, dataSize - totalWritten, &written, NULL) || written == 0) {
            CloseHandle(hFile);
            return FALSE;
        }
        totalWritten += written;
    }
    
    CloseHandle(hFile);
    return TRUE;
}

int ReceiveExact(SOCKET sock, char* out, int wanted) {
    int total = 0;
    while (total < wanted) {
        int n = recv(sock, out + total, wanted - total, 0);
        if (n > 0) total += n;
        else if (n == 0) return 0;      // connection closed
        else return -1;                 // SOCKET_ERROR
    }
    return total;
}

bool RecvLengthPrefixedMessage(SOCKET sock, std::vector<char>& outMsg, uint32_t maxLen = 8 * 1024 * 1024) {
    outMsg.clear();
    
    auto recvExact = [&](char* buf, int wanted) -> bool {
        int total = 0;
        while (total < wanted) {
            int n = recv(sock, buf + total, wanted - total, 0);
            if (n > 0) total += n;
            else return false;
        }
        return true;
    };
    
    uint32_t netLen = 0;
    if (!recvExact(reinterpret_cast<char*>(&netLen), sizeof(netLen))) return false;
    
    uint32_t msgLen = ntohl(netLen);
    if (msgLen > maxLen) return false;
    
    outMsg.resize(msgLen);
    if (msgLen == 0) return true;
    
    return recvExact(outMsg.data(), static_cast<int>(msgLen));
}

// ============ YOUR NEW GLUE FUNCTION ============

// Receive a file from socket and save to disk
// Protocol: [4-byte length prefix][file data]
// Returns TRUE on success, FALSE on failure
BOOL ReceiveFile(SOCKET sock, const char* savePath) {
    std::vector<char> fileData;
    
    // Receive length-prefixed message (contains entire file)
    if (!RecvLengthPrefixedMessage(sock, fileData, 100 * 1024 * 1024)) { // 100MB max
        printf("[!] Failed to receive file data\n");
        return FALSE;
    }
    
    if (fileData.empty()) {
        printf("[!] Received empty file\n");
        return FALSE;
    }
    
    // Save to disk
    if (!SaveBufferToFile(savePath, (BYTE*)fileData.data(), (DWORD)fileData.size())) {
        printf("[!] Failed to save file to %s\n", savePath);
        return FALSE;
    }
    
    printf("[+] File saved successfully: %s (%zu bytes)\n", savePath, fileData.size());
    return TRUE;
}

// Alternative: Receive file with progress callback
BOOL ReceiveFileWithProgress(SOCKET sock, const char* savePath, void (*progressCallback)(DWORD received, DWORD total)) {
    // First receive 4-byte length
    uint32_t netLen = 0;
    if (ReceiveExact(sock, (char*)&netLen, sizeof(netLen)) != sizeof(netLen)) {
        printf("[!] Failed to receive file length\n");
        return FALSE;
    }
    
    uint32_t fileSize = ntohl(netLen);
    printf("[+] Expecting file: %lu bytes\n", fileSize);
    
    if (fileSize == 0 || fileSize > 100 * 1024 * 1024) {
        printf("[!] Invalid file size: %lu\n", fileSize);
        return FALSE;
    }
    
    // Open file for writing
    HANDLE hFile = CreateFileA(savePath, GENERIC_WRITE, FILE_SHARE_READ, NULL,
                                CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) {
        printf("[!] Cannot create file: %s\n", savePath);
        return FALSE;
    }
    
    // Receive and write in chunks
    char buffer[65536]; // 64KB chunks
    DWORD totalReceived = 0;
    
    while (totalReceived < fileSize) {
        DWORD bytesToRead = std::min<DWORD>(sizeof(buffer), fileSize - totalReceived);
        int bytesReceived = ReceiveExact(sock, buffer, bytesToRead);
        
        if (bytesReceived != bytesToRead) {
            printf("[!] Receive failed at %lu/%lu\n", totalReceived, fileSize);
            CloseHandle(hFile);
            DeleteFileA(savePath);
            return FALSE;
        }
        
        DWORD bytesWritten = 0;
        if (!WriteFile(hFile, buffer, bytesReceived, &bytesWritten, NULL) || bytesWritten != bytesReceived) {
            printf("[!] Write failed at %lu/%lu\n", totalReceived, fileSize);
            CloseHandle(hFile);
            DeleteFileA(savePath);
            return FALSE;
        }
        
        totalReceived += bytesReceived;
        
        if (progressCallback) {
            progressCallback(totalReceived, fileSize);
        }
        
        printf("\r[+] Progress: %.1f%%", (totalReceived * 100.0) / fileSize);
    }
    
    printf("\n[+] File download complete: %s\n", savePath);
    CloseHandle(hFile);
    return TRUE;
}

// Local inter-process communication utility for file transfer between trusted processes.
BOOL SendFileToPipe(HANDLE hPipe, const char* filePath) {
    HANDLE hFile = INVALID_HANDLE_VALUE;
    BOOL success = FALSE;

    if (hPipe == NULL || hPipe == INVALID_HANDLE_VALUE || !filePath || filePath[0] == '\0') {
        return FALSE;
    }

    hFile = CreateFileA(
        filePath,
        GENERIC_READ,
        FILE_SHARE_READ,
        NULL,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        NULL
    );
    if (hFile == INVALID_HANDLE_VALUE) {
        return FALSE;
    }

    while (TRUE) {
        BYTE buffer[65536];
        DWORD bytesRead = 0;

        if (!ReadFile(hFile, buffer, sizeof(buffer), &bytesRead, NULL)) {
            goto cleanup;
        }

        if (bytesRead == 0) {
            success = TRUE;
            break;
        }

        DWORD totalWritten = 0;
        while (totalWritten < bytesRead) {
            DWORD bytesWritten = 0;
            if (!WriteFile(hPipe, buffer + totalWritten, bytesRead - totalWritten, &bytesWritten, NULL) || bytesWritten == 0) {
                goto cleanup;
            }
            totalWritten += bytesWritten;
        }
    }

cleanup:
    if (hFile != INVALID_HANDLE_VALUE) {
        CloseHandle(hFile);
    }
    return success;
}