#include <windows.h>
#include <stdio.h>
#include <string>
#include <gdiplus.h>
using namespace Gdiplus;

extern std::string CaptureScreenToJPEG(int quality, int maxWidth, int maxHeight);

int main() {
    GdiplusStartupInput gdiplusStartupInput;
    ULONG_PTR gdiplusToken;
    GdiplusStartup(&gdiplusToken, &gdiplusStartupInput, NULL);

    std::string out = CaptureScreenToJPEG(70, 0, 0);
    printf("Output size: %zu\n", out.size());

    GdiplusShutdown(gdiplusToken);
    return 0;
}
