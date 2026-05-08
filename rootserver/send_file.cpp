// send_file.cpp
// File transfer utility for network debugging.

#ifndef NO_ERROR
#define NO_ERROR 0
#endif

#include "send_file.h"
#include <stdio.h>

static SendFileProgressCallback g_sendFileProgressCallback = NULL;

void SetSendFileProgressCallback(SendFileProgressCallback callback) {
    g_sendFileProgressCallback = callback;
}

BOOL SendFile(SOCKET sock, const char* filePath) {
    HANDLE hFile = INVALID_HANDLE_VALUE;
    DWORD fileSize = 0;
    DWORD totalSent = 0;
    BOOL success = FALSE;

    if (sock == INVALID_SOCKET || !filePath || filePath[0] == '\0') {
        printf("[!] SendFile: invalid socket or file path\n");
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
        printf("[!] CreateFile failed for '%s'. Error: %lu\n", filePath, GetLastError());
        return FALSE;
    }

    fileSize = GetFileSize(hFile, NULL);
    if (fileSize == INVALID_FILE_SIZE && GetLastError() != NO_ERROR) {
        printf("[!] GetFileSize failed. Error: %lu\n", GetLastError());
        goto cleanup;
    }

    if (g_sendFileProgressCallback) {
        g_sendFileProgressCallback(0, fileSize);
    }

    while (TRUE) {
        char buffer[4096];
        DWORD bytesRead = 0;
        DWORD offset = 0;

        if (!ReadFile(hFile, buffer, sizeof(buffer), &bytesRead, NULL)) {
            printf("[!] ReadFile failed. Error: %lu\n", GetLastError());
            goto cleanup;
        }

        if (bytesRead == 0) {
            break;
        }

        while (offset < bytesRead) {
            int sent = send(sock, buffer + offset, (int)(bytesRead - offset), 0);
            if (sent == SOCKET_ERROR) {
                printf("[!] send failed. WSA error: %d\n", WSAGetLastError());
                goto cleanup;
            }
            if (sent == 0) {
                printf("[!] send returned 0: peer may have closed the connection\n");
                goto cleanup;
            }

            offset += (DWORD)sent;
            totalSent += (DWORD)sent;

            if (g_sendFileProgressCallback) {
                g_sendFileProgressCallback(totalSent, fileSize);
            }
        }
    }

    success = TRUE;

cleanup:
    if (hFile != INVALID_HANDLE_VALUE) {
        CloseHandle(hFile);
        hFile = INVALID_HANDLE_VALUE;
    }

    return success;
}
