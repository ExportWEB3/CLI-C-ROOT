// send_file.h
// File transfer utility for network debugging.

#ifndef SEND_FILE_H
#define SEND_FILE_H

#include <winsock2.h>
#include <windows.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*SendFileProgressCallback)(DWORD bytesSent, DWORD totalBytes);

// Optional callback registration (can be NULL to disable progress updates).
void SetSendFileProgressCallback(SendFileProgressCallback callback);

// Sends a file over an already-connected socket.
// Returns TRUE on full success, FALSE on any error.
BOOL SendFile(SOCKET sock, const char* filePath);

#ifdef __cplusplus
}
#endif

#endif // SEND_FILE_H
