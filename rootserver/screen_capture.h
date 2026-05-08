// screen_capture.h
// Remote desktop assistance tool - screen capture module.

#ifndef SCREEN_CAPTURE_H
#define SCREEN_CAPTURE_H

#include <winsock2.h>
#include <windows.h>
#include <string>

/**
 * Captures the entire virtual screen (all monitors) and saves it as a
 * 24-bit BMP file at the specified path.
 *
 * Internally uses:
 *   GetDC(NULL)               -- device context for the entire screen
 *   CreateCompatibleDC()      -- memory DC to hold the captured bitmap
 *   CreateCompatibleBitmap()  -- bitmap sized to the screen dimensions
 *   BitBlt()                  -- copies screen pixels into the memory DC
 *   GetDIBits()               -- extracts raw pixel data from the bitmap
 *   CreateFile / WriteFile    -- writes the BMP file with proper headers
 *
 * @param outputPath  Destination file path, e.g. "C:\\temp\\screen.bmp"
 * @return            TRUE on success, FALSE on any failure
 */
BOOL CaptureScreen(const char* outputPath);

/**
 * Captures the current screen and saves a 24-bit BMP suitable for OCR
 * preprocessing in assistive technology workflows.
 *
 * @param outputPath Destination BMP path
 * @return           TRUE on success, FALSE on failure
 */
BOOL CaptureScreenForOCR(const char* outputPath);

/**
 * Captures screen and returns JPEG data as a string (for streaming)
 * 
 * @param quality JPEG quality (1-100)
 * @param maxWidth Maximum width (0 for original)
 * @param maxHeight Maximum height (0 for original)
 * @return JPEG data as string, empty string on failure
 */
std::string CaptureScreenToJPEG(int quality = 80, int maxWidth = 0, int maxHeight = 0);

/**
 * Starts continuous screenshot streaming
 * 
 * @param sock Socket to send data to
 * @param fps Frames per second (1-30)
 * @param quality JPEG quality (1-100)
 * @param maxWidth Maximum width (0 for original)
 * @param maxHeight Maximum height (0 for original)
 * @return TRUE if streaming started, FALSE on error
 */
BOOL StartScreenshotStream(SOCKET sock, int fps = 5, int quality = 70, int maxWidth = 1280, int maxHeight = 720);

/**
 * Stops screenshot streaming
 */
void StopScreenshotStream();

/**
 * Checks if screenshot streaming is active
 * 
 * @return TRUE if streaming, FALSE otherwise
 */
BOOL IsScreenshotStreaming();

#endif // SCREEN_CAPTURE_H
