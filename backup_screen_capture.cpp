// screen_capture.cpp
// Remote desktop assistance tool - screen capture module.
// Captures the full virtual desktop (all monitors) and writes a 24-bit BMP file.

#include "screen_capture.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

/**
 * Captures the entire virtual screen and saves it as a 24-bit BMP file.
 *
 * Steps:
 *  1. Obtain a screen DC with GetDC(NULL) and read screen dimensions
 *     via GetSystemMetrics() using SM_XVIRTUALSCREEN / SM_YVIRTUALSCREEN
 *     so multi-monitor setups are captured correctly.
 *  2. Create a compatible memory DC and bitmap with CreateCompatibleDC /
 *     CreateCompatibleBitmap.
 *  3. Copy the screen into the memory bitmap using BitBlt with SRCCOPY.
 *  4. Extract raw pixel bytes with GetDIBits (bottom-up, 24 bpp).
 *  5. Build BITMAPFILEHEADER + BITMAPINFOHEADER and write the BMP via
 *     CreateFile / WriteFile.
 *  6. Release all GDI objects and the screen DC.
 *
 * @param outputPath  Destination file path for the BMP
 * @return            TRUE on success, FALSE on any failure
 */
BOOL CaptureScreen(const char* outputPath) {
    // All declarations hoisted above any goto to avoid crossing-init errors
    BOOL             success         = FALSE;
    HDC              hScreenDC       = NULL;
    HDC              hMemDC          = NULL;
    HBITMAP          hBitmap         = NULL;
    HGDIOBJ          hOldBitmap      = NULL;
    BYTE*            pPixels         = NULL;
    HANDLE           hFile           = INVALID_HANDLE_VALUE;
    int              screenX         = 0;
    int              screenY         = 0;
    int              width           = 0;
    int              height          = 0;
    int              stride          = 0;
    int              scanLinesCopied = 0;
    DWORD            pixelSize       = 0;
    DWORD            fileSize        = 0;
    DWORD            written         = 0;
    BOOL             blitted         = FALSE;
    BITMAPINFOHEADER bi;
    BITMAPFILEHEADER bf;

    ZeroMemory(&bi, sizeof(bi));
    ZeroMemory(&bf, sizeof(bf));

    if (!outputPath || outputPath[0] == '\0') {
        printf("[!] CaptureScreen: invalid output path\n");
        return FALSE;
    }

    // ------------------------------------------------------------------ //
    //  1. Acquire screen DC and determine virtual screen dimensions
    // ------------------------------------------------------------------ //

    hScreenDC = GetDC(NULL);
    if (!hScreenDC) {
        printf("[!] GetDC(NULL) failed: %lu\n", GetLastError());
        goto cleanup;
    }

    // SM_XVIRTUALSCREEN / SM_CXVIRTUALSCREEN cover all monitors combined
    screenX = GetSystemMetrics(SM_XVIRTUALSCREEN);
    screenY = GetSystemMetrics(SM_YVIRTUALSCREEN);
    width   = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    height  = GetSystemMetrics(SM_CYVIRTUALSCREEN);

    if (width <= 0 || height <= 0) {
        width   = GetSystemMetrics(SM_CXSCREEN);
        height  = GetSystemMetrics(SM_CYSCREEN);
        screenX = 0;
        screenY = 0;
    }

    printf("[+] Capturing virtual screen: origin=(%d,%d) size=%dx%d\n",
           screenX, screenY, width, height);

    // ------------------------------------------------------------------ //
    //  2. Create a compatible memory DC and a compatible bitmap
    // ------------------------------------------------------------------ //

    hMemDC = CreateCompatibleDC(hScreenDC);
    if (!hMemDC) {
        printf("[!] CreateCompatibleDC failed: %lu\n", GetLastError());
        goto cleanup;
    }

    // Must reference the SCREEN DC so colour depth matches the display
    hBitmap = CreateCompatibleBitmap(hScreenDC, width, height);
    if (!hBitmap) {
        printf("[!] CreateCompatibleBitmap failed: %lu\n", GetLastError());
        goto cleanup;
    }

    hOldBitmap = SelectObject(hMemDC, hBitmap);

    // ------------------------------------------------------------------ //
    //  3. BitBlt -- copy the live screen into the memory DC
    // ------------------------------------------------------------------ //

    // CAPTUREBLT includes layered/transparent windows
    blitted = BitBlt(
        hMemDC, 0, 0, width, height,
        hScreenDC, screenX, screenY,
        SRCCOPY | CAPTUREBLT
    );

    SelectObject(hMemDC, hOldBitmap);   // restore before GetDIBits

    if (!blitted) {
        printf("[!] BitBlt failed: %lu\n", GetLastError());
        goto cleanup;
    }

    // ------------------------------------------------------------------ //
    //  4. Extract raw pixel data with GetDIBits (24 bpp, bottom-up)
    // ------------------------------------------------------------------ //

    stride    = ((width * 3) + 3) & ~3;       // DWORD-aligned row stride
    pixelSize = (DWORD)(stride * height);

    pPixels = (BYTE*)malloc(pixelSize);
    if (!pPixels) {
        printf("[!] malloc failed for pixel buffer (%lu bytes)\n", pixelSize);
        goto cleanup;
    }
    ZeroMemory(pPixels, pixelSize);

    bi.biSize        = sizeof(BITMAPINFOHEADER);
    bi.biWidth       = width;
    bi.biHeight      = height;   // positive = bottom-up (standard BMP)
    bi.biPlanes      = 1;
    bi.biBitCount    = 24;
    bi.biCompression = BI_RGB;
    bi.biSizeImage   = pixelSize;

    // Re-select bitmap so GetDIBits can read from it
    hOldBitmap = SelectObject(hMemDC, hBitmap);

    scanLinesCopied = GetDIBits(
        hMemDC, hBitmap,
        0, (UINT)height,
        pPixels,
        (BITMAPINFO*)&bi,
        DIB_RGB_COLORS
    );

    SelectObject(hMemDC, hOldBitmap);

    if (scanLinesCopied == 0) {
        printf("[!] GetDIBits failed: %lu\n", GetLastError());
        goto cleanup;
    }
    printf("[+] GetDIBits copied %d scan lines\n", scanLinesCopied);

    // ------------------------------------------------------------------ //
    //  5. Build BMP file headers and write to disk via CreateFile/WriteFile
    // ------------------------------------------------------------------ //

    fileSize = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPINFOHEADER) + pixelSize;

    bf.bfType      = 0x4D42;                                             // 'BM'
    bf.bfSize      = fileSize;
    bf.bfReserved1 = 0;
    bf.bfReserved2 = 0;
    bf.bfOffBits   = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPINFOHEADER);

    hFile = CreateFileA(
        outputPath,
        GENERIC_WRITE,
        0,
        NULL,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        NULL
    );

    if (hFile == INVALID_HANDLE_VALUE) {
        printf("[!] CreateFile failed for '%s': %lu\n", outputPath, GetLastError());
        goto cleanup;
    }

    // Write BITMAPFILEHEADER
    if (!WriteFile(hFile, &bf, sizeof(bf), &written, NULL) || written != sizeof(bf)) {
        printf("[!] WriteFile (BITMAPFILEHEADER) failed: %lu\n", GetLastError());
        goto cleanup;
    }

    // Write BITMAPINFOHEADER
    written = 0;
    if (!WriteFile(hFile, &bi, sizeof(bi), &written, NULL) || written != sizeof(bi)) {
        printf("[!] WriteFile (BITMAPINFOHEADER) failed: %lu\n", GetLastError());
        goto cleanup;
    }

    // Write raw pixel data
    written = 0;
    if (!WriteFile(hFile, pPixels, pixelSize, &written, NULL) || written != pixelSize) {
        printf("[!] WriteFile (pixel data) failed: %lu\n", GetLastError());
        goto cleanup;
    }

    success = TRUE;

    // ------------------------------------------------------------------ //
    //  6. Release all resources
    // ------------------------------------------------------------------ //

cleanup:
    if (hFile != INVALID_HANDLE_VALUE) CloseHandle(hFile);
    if (pPixels)                        free(pPixels);
    if (hBitmap)                        DeleteObject(hBitmap);
    if (hMemDC)                         DeleteDC(hMemDC);
    if (hScreenDC)                      ReleaseDC(NULL, hScreenDC);

    return success;
}

BOOL CaptureScreenForOCR(const char* outputPath) {
    HDC hScreenDC = NULL;
    HDC hMemDC = NULL;
    HBITMAP hBitmap = NULL;
    HGDIOBJ hOldBitmap = NULL;
    HANDLE hFile = INVALID_HANDLE_VALUE;
    BYTE* pixelData = NULL;
    BOOL success = FALSE;
    int width = 0;
    int height = 0;
    int stride = 0;
    DWORD imageSize = 0;
    DWORD written = 0;
    BITMAPINFOHEADER bi;
    BITMAPFILEHEADER bf;

    if (!outputPath || outputPath[0] == '\0') {
        SetLastError(87); // ERROR_INVALID_PARAMETER
        return FALSE;
    }

    ZeroMemory(&bi, sizeof(bi));
    ZeroMemory(&bf, sizeof(bf));

    hScreenDC = GetDC(NULL);
    if (!hScreenDC) goto cleanup;

    width = GetSystemMetrics(SM_CXSCREEN);
    height = GetSystemMetrics(SM_CYSCREEN);
    if (width <= 0 || height <= 0) {
        SetLastError(13); // ERROR_INVALID_DATA
        goto cleanup;
    }

    hMemDC = CreateCompatibleDC(hScreenDC);
    if (!hMemDC) goto cleanup;

    hBitmap = CreateCompatibleBitmap(hScreenDC, width, height);
    if (!hBitmap) goto cleanup;

    hOldBitmap = SelectObject(hMemDC, hBitmap);
    if (!hOldBitmap) goto cleanup;

    if (!BitBlt(hMemDC, 0, 0, width, height, hScreenDC, 0, 0, SRCCOPY | CAPTUREBLT)) goto cleanup;

    stride = ((width * 3) + 3) & ~3;
    imageSize = (DWORD)(stride * height);
    pixelData = (BYTE*)malloc(imageSize);
    if (!pixelData) {
        SetLastError(14); // ERROR_OUTOFMEMORY
        goto cleanup;
    }

    bi.biSize = sizeof(BITMAPINFOHEADER);
    bi.biWidth = width;
    bi.biHeight = height;
    bi.biPlanes = 1;
    bi.biBitCount = 24;
    bi.biCompression = BI_RGB;
    bi.biSizeImage = imageSize;

    if (GetDIBits(hMemDC, hBitmap, 0, (UINT)height, pixelData, (BITMAPINFO*)&bi, DIB_RGB_COLORS) == 0) goto cleanup;

    bf.bfType = 0x4D42;
    bf.bfOffBits = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPINFOHEADER);
    bf.bfSize = bf.bfOffBits + imageSize;

    hFile = CreateFileA(outputPath, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) goto cleanup;

    if (!WriteFile(hFile, &bf, sizeof(bf), &written, NULL) || written != sizeof(bf)) goto cleanup;
    if (!WriteFile(hFile, &bi, sizeof(bi), &written, NULL) || written != sizeof(bi)) goto cleanup;
    if (!WriteFile(hFile, pixelData, imageSize, &written, NULL) || written != imageSize) goto cleanup;

    success = TRUE;

cleanup:
    if (hFile != INVALID_HANDLE_VALUE) CloseHandle(hFile);
    if (pixelData) free(pixelData);
    if (hOldBitmap) SelectObject(hMemDC, hOldBitmap);
    if (hBitmap) DeleteObject(hBitmap);
    if (hMemDC) DeleteDC(hMemDC);
    if (hScreenDC) ReleaseDC(NULL, hScreenDC);
    return success;
}

// Global variables for screenshot streaming
static volatile BOOL g_streaming = FALSE;
static SOCKET g_streamSocket = INVALID_SOCKET;
static HANDLE g_streamThread = NULL;
static int g_streamFPS = 5;
static int g_streamQuality = 70;
static int g_streamMaxWidth = 1280;
static int g_streamMaxHeight = 720;

static const std::string base64_chars = 
             "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
             "abcdefghijklmnopqrstuvwxyz"
             "0123456789+/";

static inline std::string base64_encode(const unsigned char* bytes_to_encode, unsigned int in_len) {
  std::string ret;
  int i = 0, j = 0;
  unsigned char char_array_3[3];
  unsigned char char_array_4[4];

  ret.reserve((in_len + 2) / 3 * 4); // Pre-allocate

  while (in_len--) {
    char_array_3[i++] = *(bytes_to_encode++);
    if (i == 3) {
      char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
      char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
      char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
      char_array_4[3] = char_array_3[2] & 0x3f;

      for(i = 0; i < 4; i++) ret += base64_chars[char_array_4[i]];
      i = 0;
    }
  }

  if (i) {
    for(j = i; j < 3; j++) char_array_3[j] = '\0';
    char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
    char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
    char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
    char_array_4[3] = char_array_3[2] & 0x3f;
    for (j = 0; j < i + 1; j++) ret += base64_chars[char_array_4[j]];
    while((i++ < 3)) ret += '=';
  }
  return ret;
}

// Helper function to compress bitmap to JPEG
std::string CompressBitmapToJPEG(HBITMAP hBitmap, int quality, int maxWidth, int maxHeight) {
    std::string result;
    
    // TODO: Implement JPEG compression using GDI+ or stb_image_write
    // For now, return empty string (placeholder)
    
    return result;
}

// Thread function for continuous screenshot streaming
DWORD WINAPI ScreenshotStreamThread(LPVOID lpParam) {
    while (g_streaming) {
        // Capture screen to JPEG (currently returns base64 BMP)
        std::string jpegData = CaptureScreenToJPEG(g_streamQuality, g_streamMaxWidth, g_streamMaxHeight);

        if (!jpegData.empty() && g_streamSocket != INVALID_SOCKET) {
            // Send JPEG data over socket
            // Format: "SCREENSHOT_STREAM|size|data\n"
            std::string header = "SCREENSHOT_STREAM|" + std::to_string(jpegData.size()) + "|";
            std::string message = header + jpegData + "\n";

            int totalSent = 0;
            int length = message.size();
            while (totalSent < length) {
                int bytesSent = send(g_streamSocket, message.c_str() + totalSent, length - totalSent, 0);
                if (bytesSent <= 0) {
                    g_streaming = FALSE;
                    break;
                }
                totalSent += bytesSent;
            }
        }

        // Sleep based on FPS
        int sleepTime = 1000 / g_streamFPS;
        if (sleepTime < 33) sleepTime = 33; // Max 30 FPS
        Sleep(sleepTime);
    }

    return 0;
}

std::string CaptureScreenToJPEG(int quality, int maxWidth, int maxHeight) {
    HDC hScreenDC = GetDC(NULL);
    if (!hScreenDC) return "";

    int screenX = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int screenY = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    int height = GetSystemMetrics(SM_CYVIRTUALSCREEN);

    if (width <= 0 || height <= 0) {
        ReleaseDC(NULL, hScreenDC);
        return "";
    }

    HDC hMemDC = CreateCompatibleDC(hScreenDC);
    HBITMAP hBitmap = CreateCompatibleBitmap(hScreenDC, width, height);

    if (!hMemDC || !hBitmap) {
        if (hBitmap) DeleteObject(hBitmap);
        if (hMemDC) DeleteDC(hMemDC);
        ReleaseDC(NULL, hScreenDC);
        return "";
    }

    HGDIOBJ hOldBitmap = SelectObject(hMemDC, hBitmap);
    BitBlt(hMemDC, 0, 0, width, height, hScreenDC, screenX, screenY, SRCCOPY);

    BITMAPINFOHEADER bi;
    ZeroMemory(&bi, sizeof(bi));
    bi.biSize = sizeof(bi);
    bi.biWidth = width;
    bi.biHeight = height;
    bi.biPlanes = 1;
    bi.biBitCount = 24;
    bi.biCompression = BI_RGB;

    int stride = ((width * 24 + 31) & ~31) >> 3;
    DWORD pixelSize = stride * height;
    BYTE* pPixels = (BYTE*)malloc(pixelSize);

    std::string b64Result = "";

    if (pPixels && GetDIBits(hMemDC, hBitmap, 0, height, pPixels, (BITMAPINFO*)&bi, DIB_RGB_COLORS)) {
        BITMAPFILEHEADER bf;
        ZeroMemory(&bf, sizeof(bf));
        bf.bfType = 0x4D42;
        bf.bfSize = sizeof(bf) + sizeof(bi) + pixelSize;
        bf.bfOffBits = sizeof(bf) + sizeof(bi);

        std::string bmpData(bf.bfSize, '\0');
        memcpy(&bmpData[0], &bf, sizeof(bf));
        memcpy(&bmpData[0] + sizeof(bf), &bi, sizeof(bi));
        memcpy(&bmpData[0] + sizeof(bf) + sizeof(bi), pPixels, pixelSize);

        b64Result = base64_encode(reinterpret_cast<const unsigned char*>(bmpData.c_str()), bf.bfSize);
    }

    if (pPixels) free(pPixels);
    SelectObject(hMemDC, hOldBitmap);
    DeleteObject(hBitmap);
    DeleteDC(hMemDC);
    ReleaseDC(NULL, hScreenDC);

    return b64Result;
}

BOOL StartScreenshotStream(SOCKET sock, int fps, int quality, int maxWidth, int maxHeight) {
    if (g_streaming) {
        return FALSE; // Already streaming
    }

    if (fps < 1) fps = 1;
    if (fps > 30) fps = 30;
    if (quality < 1) quality = 1;
    if (quality > 100) quality = 100;

    g_streamSocket = sock;
    g_streamFPS = fps;
    g_streamQuality = quality;
    g_streamMaxWidth = maxWidth;
    g_streamMaxHeight = maxHeight;
    g_streaming = TRUE;

    // Create streaming thread
    g_streamThread = CreateThread(NULL, 0, ScreenshotStreamThread, NULL, 0, NULL);
    if (g_streamThread == NULL) {
        g_streaming = FALSE;
        g_streamSocket = INVALID_SOCKET;        return FALSE;
    }

    return TRUE;}

void StopScreenshotStream() {
    g_streaming = FALSE;
    
    if (g_streamThread) {
        WaitForSingleObject(g_streamThread, 5000);
        CloseHandle(g_streamThread);
        g_streamThread = NULL;
    }
    
    g_streamSocket = INVALID_SOCKET;
}

BOOL IsScreenshotStreaming() {
    return g_streaming;
}
