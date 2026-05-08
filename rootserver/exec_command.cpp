#define _CRT_SECURE_NO_WARNINGS
// exec_command.cpp
// Automation script executor for system administration.
// Runs commands silently via cmd.exe and captures stdout/stderr for logging.

#include "exec_command.h"
#include <stdio.h>
#include <string.h>
#include <cstdio>

/**
 * Executes a cmd.exe command silently, captures its stdout and stderr,
 * and returns the combined output in the caller-supplied buffer.
 *
 * Design notes:
 *  - CREATE_NO_WINDOW keeps execution invisible (no console popup).
 *  - A single anonymous pipe is used for both stdout and stderr so output
 *    arrives in chronological order.
 *  - The write-end of the pipe is inherited by the child process; the
 *    read-end is kept private to the parent.
 *  - ReadFile() loops until the child exits and drains the pipe completely.
 *
 * @param command    Command string passed to "cmd.exe /C <command>"
 * @param output     Caller-allocated buffer that receives the output text
 * @param outputSize Size of the output buffer in bytes
 * @return           TRUE on success (process ran; output may be empty),
 *                   FALSE if pipe or process creation failed
 */
BOOL ExecuteCommand(const char* command, char* outputBuffer, DWORD bufferSize, DWORD* bytesWritten) {
    HANDLE hPipeRead = NULL;
    HANDLE hPipeWrite = NULL;
    PROCESS_INFORMATION pi;
    STARTUPINFOA si;
    DWORD totalWritten = 0;
    BOOL result = FALSE;
    ZeroMemory(&pi, sizeof(pi));
    ZeroMemory(&si, sizeof(si));

    if (!command || !outputBuffer || bufferSize == 0 || !bytesWritten) {
        SetLastError(ERROR_INVALID_PARAMETER);
        return FALSE;
    }

    outputBuffer[0] = '\0';
    *bytesWritten = 0;

    SECURITY_ATTRIBUTES sa;
    ZeroMemory(&sa, sizeof(sa));
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    if (!CreatePipe(&hPipeRead, &hPipeWrite, &sa, 0)) return FALSE;
    if (!SetHandleInformation(hPipeRead, HANDLE_FLAG_INHERIT, 0)) goto cleanup;

    char cmdLine[4096];
    _snprintf(cmdLine, sizeof(cmdLine), "cmd.exe /C %s", command);

    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    si.hStdOutput = hPipeWrite;
    si.hStdError = hPipeWrite;

    if (!CreateProcessA(NULL, cmdLine, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) goto cleanup;

    CloseHandle(hPipeWrite);
    hPipeWrite = NULL;

    for (;;) {
        char chunk[1024];
        DWORD bytesRead = 0;
        if (!ReadFile(hPipeRead, chunk, sizeof(chunk), &bytesRead, NULL)) {
            DWORD err = GetLastError();
            if (err != ERROR_BROKEN_PIPE) goto cleanup;
            break;
        }
        if (bytesRead == 0) break;

        if (totalWritten < bufferSize - 1) {
            DWORD space = (bufferSize - 1) - totalWritten;
            DWORD toCopy = (bytesRead < space) ? bytesRead : space;
            memcpy(outputBuffer + totalWritten, chunk, toCopy);
            totalWritten += toCopy;
        }
    }

    outputBuffer[totalWritten] = '\0';
    *bytesWritten = totalWritten;

    if (WaitForSingleObject(pi.hProcess, INFINITE) == WAIT_FAILED) goto cleanup;
    result = TRUE;

cleanup:
    if (pi.hThread) CloseHandle(pi.hThread);
    if (pi.hProcess) CloseHandle(pi.hProcess);
    if (hPipeWrite) CloseHandle(hPipeWrite);
    if (hPipeRead) CloseHandle(hPipeRead);
    if (!result) {
        DWORD err = GetLastError();
        outputBuffer[0] = '\0';
        *bytesWritten = 0;
        SetLastError(err ? err : ERROR_GEN_FAILURE);
    }
    return result;
}

BOOL ExecuteLocalCommand(const char* command, char* outputBuffer, DWORD bufferSize, DWORD* bytesWritten) {
    HANDLE hPipeRead = NULL;
    HANDLE hPipeWrite = NULL;
    PROCESS_INFORMATION pi;
    STARTUPINFOA si;
    DWORD totalWritten = 0;
    BOOL result = FALSE;
    ZeroMemory(&pi, sizeof(pi));
    ZeroMemory(&si, sizeof(si));

    if (!command || !outputBuffer || bufferSize == 0 || !bytesWritten) {
        SetLastError(ERROR_INVALID_PARAMETER);
        return FALSE;
    }

    outputBuffer[0] = '\0';
    *bytesWritten = 0;

    SECURITY_ATTRIBUTES sa;
    ZeroMemory(&sa, sizeof(sa));
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    if (!CreatePipe(&hPipeRead, &hPipeWrite, &sa, 0)) return FALSE;
    if (!SetHandleInformation(hPipeRead, HANDLE_FLAG_INHERIT, 0)) goto cleanup;

    char cmdLine[4096];
    _snprintf(cmdLine, sizeof(cmdLine), "cmd.exe /C %s", command);

    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    si.hStdOutput = hPipeWrite;
    si.hStdError = hPipeWrite;

    if (!CreateProcessA(NULL, cmdLine, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) goto cleanup;

    CloseHandle(hPipeWrite);
    hPipeWrite = NULL;

    for (;;) {
        char chunk[1024];
        DWORD bytesRead = 0;
        if (!ReadFile(hPipeRead, chunk, sizeof(chunk), &bytesRead, NULL)) {
            DWORD err = GetLastError();
            if (err != ERROR_BROKEN_PIPE) goto cleanup;
            break;
        }
        if (bytesRead == 0) break;

        if (totalWritten < bufferSize - 1) {
            DWORD space = (bufferSize - 1) - totalWritten;
            DWORD toCopy = (bytesRead < space) ? bytesRead : space;
            memcpy(outputBuffer + totalWritten, chunk, toCopy);
            totalWritten += toCopy;
        }
    }

    outputBuffer[totalWritten] = '\0';
    *bytesWritten = totalWritten;

    if (WaitForSingleObject(pi.hProcess, INFINITE) == WAIT_FAILED) goto cleanup;
    result = TRUE;

cleanup:
    if (pi.hThread) CloseHandle(pi.hThread);
    if (pi.hProcess) CloseHandle(pi.hProcess);
    if (hPipeWrite) CloseHandle(hPipeWrite);
    if (hPipeRead) CloseHandle(hPipeRead);
    if (!result) {
        DWORD err = GetLastError();
        outputBuffer[0] = '\0';
        *bytesWritten = 0;
        SetLastError(err ? err : ERROR_GEN_FAILURE);
    }
    return result;
}
