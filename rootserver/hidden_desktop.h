#ifndef HIDDEN_DESKTOP_H
#define HIDDEN_DESKTOP_H

#include <windows.h>
#include <string>
#include <vector>

// Desktop mode enum
enum DesktopMode {
    DESKTOP_VISIBLE = 0,  // User's default desktop
    DESKTOP_STEALTH = 1,  // Hidden desktop
};

// Initialize the hidden desktop system
bool InitHiddenDesktop();

// Switch the capture/input thread to a specific desktop
bool SwitchActiveDesktop(DesktopMode mode);

// Launch a process on the currently active desktop
bool LaunchOnActiveDesktop(const char* appPath, const char* args = NULL);

// Launch a process specifically on the hidden desktop
bool LaunchOnHiddenDesktop(const char* appPath, const char* args = NULL);

// Get the current active desktop mode
DesktopMode GetCurrentDesktopMode();

// Get the name of the hidden desktop
const char* GetHiddenDesktopName();

// Cleanup hidden desktop resources
void CleanupHiddenDesktop();

#endif
