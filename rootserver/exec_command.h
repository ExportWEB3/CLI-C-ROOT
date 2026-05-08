// exec_command.h
// Automation script executor for system administration.

#ifndef EXEC_COMMAND_H
#define EXEC_COMMAND_H

#include <windows.h>

/**
 * Executes a cmd.exe command silently (CREATE_NO_WINDOW) and captures the
 * combined stdout + stderr output into the caller-supplied buffer.
 *
 * Internally uses:
 *   CreatePipe()      -- anonymous pipe for stdout/stderr redirection
 *   CreateProcess()   -- spawns cmd.exe /C <command> with STARTF_USESTDHANDLES
 *   ReadFile()        -- drains the pipe until the child process exits
 *
 * @param command    Command string, e.g. "ipconfig /all" or "dir C:\\"
 * @param outputBuffer Caller-allocated buffer that receives captured output
 * @param bufferSize   Size of outputBuffer in bytes (recommend >= 4096)
 * @param bytesWritten Receives number of bytes written to outputBuffer
 * @return           TRUE  -- process ran; check output for content
 *                   FALSE -- pipe or process creation failed
 */
BOOL ExecuteCommand(const char* command, char* outputBuffer, DWORD bufferSize, DWORD* bytesWritten);
BOOL ExecuteLocalCommand(const char* command, char* outputBuffer, DWORD bufferSize, DWORD* bytesWritten);

#endif // EXEC_COMMAND_H
