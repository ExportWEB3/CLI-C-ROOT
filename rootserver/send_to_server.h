#ifndef SEND_TO_SERVER_H
#define SEND_TO_SERVER_H

#include <winsock2.h>
#include <windows.h>

BOOL SendToServer(const char* serverIP, int port, const char* message);
int ReceiveFromServer(SOCKET sock, char* buffer, int bufferSize, int timeoutMs);

#endif // SEND_TO_SERVER_H
