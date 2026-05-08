#include <windows.h>
#include <iostream>

int main() {
    HWND hwnd = CreateWindowExA(
        WS_EX_LAYERED | WS_EX_TOPMOST, 
        "STATIC", 
        "Test Layered", 
        WS_POPUP | WS_VISIBLE, 
        100, 100, 500, 500, 
        NULL, NULL, NULL, NULL
    );
    // Fill the window with white using SetLayeredWindowAttributes color key
    SetLayeredWindowAttributes(hwnd, RGB(0,0,0), 255, LWA_ALPHA);
    
    // Give it time to render
    Sleep(2000); 

    HDC hScreenDC = GetDC(NULL);
    HDC hMemDC = CreateCompatibleDC(hScreenDC);
    HBITMAP hBitmap = CreateCompatibleBitmap(hScreenDC, 500, 500);
    hBitmap = (HBITMAP)SelectObject(hMemDC, hBitmap);

    // Try without CAPTUREBLT
    BitBlt(hMemDC, 0, 0, 500, 500, hScreenDC, 100, 100, SRCCOPY);

    // Read middle pixel
    COLORREF color1 = GetPixel(hMemDC, 250, 250);
    
    // Try WITH CAPTUREBLT
    BitBlt(hMemDC, 0, 0, 500, 500, hScreenDC, 100, 100, SRCCOPY | CAPTUREBLT);
    COLORREF color2 = GetPixel(hMemDC, 250, 250);

    // Get true pixel beneath (if possible?) -- maybe PrintWindow(hwnd_desktop)
    
    std::cout << "Color WITHOUT CAPTUREBLT: " << std::hex << color1 << std::endl;
    std::cout << "Color WITH CAPTUREBLT: " << std::hex << color2 << std::endl;

    DeleteObject(hBitmap);
    DeleteDC(hMemDC);
    ReleaseDC(NULL, hScreenDC);
    return 0;
}
