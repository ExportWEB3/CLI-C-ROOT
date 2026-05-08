#include "send_to_server.h"

#include <winsock2.h>
#include <ws2tcpip.h>
#include <stdio.h>
#include <string.h>

#pragma comment(lib, "ws2_32.lib")

BOOL SendToServer(const char* serverIP, int port, const char* message) {
    if (!serverIP || !message || port <= 0 || port > 65535) return FALSE;

    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return FALSE;

    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) {
        printf("socket failed: %d\n", WSAGetLastError());
        WSACleanup();
        return FALSE;
    }

    sockaddr_in addr;
    ZeroMemory(&addr, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons((u_short)port);
    addr.sin_addr.s_addr = inet_addr(serverIP);
    if (addr.sin_addr.s_addr == INADDR_NONE) {
        printf("inet_addr failed: %d\n", WSAGetLastError());
        closesocket(sock);
        WSACleanup();
        return FALSE;
    }

    if (connect(sock, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        printf("connect failed: %d\n", WSAGetLastError());
        closesocket(sock);
        WSACleanup();
        return FALSE;
    }

    int len = (int)strlen(message);
    int sentTotal = 0;
    while (sentTotal < len) {
        int sent = send(sock, message + sentTotal, len - sentTotal, 0);
        if (sent == SOCKET_ERROR || sent == 0) {
            printf("send failed: %d\n", WSAGetLastError());
            closesocket(sock);
            WSACleanup();
            return FALSE;
        }
        sentTotal += sent;
    }

    shutdown(sock, SD_BOTH);
    closesocket(sock);
    WSACleanup();
    return TRUE;
}

int ReceiveFromServer(SOCKET sock, char* buffer, int bufferSize, int timeoutMs) {
    if (sock == INVALID_SOCKET || !buffer || bufferSize <= 0) {
        WSASetLastError(WSAEINVAL);
        return SOCKET_ERROR;
    }

    if (timeoutMs >= 0) {
        fd_set readSet;
        FD_ZERO(&readSet);
        FD_SET(sock, &readSet);

        timeval tv;
        tv.tv_sec = timeoutMs / 1000;
        tv.tv_usec = (timeoutMs % 1000) * 1000;

        int ready = select(0, &readSet, NULL, NULL, &tv);
        if (ready == SOCKET_ERROR) {
            return SOCKET_ERROR;
        }
        if (ready == 0) {
            WSASetLastError(WSAETIMEDOUT);
            return SOCKET_ERROR;
        }
    }

    return recv(sock, buffer, bufferSize, 0);
}
