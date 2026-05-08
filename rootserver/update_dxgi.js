const fs = require('fs');
let code = fs.readFileSync('screen_capture.cpp', 'utf8');

// 1. Add headers
code = code.replace('#include <gdiplus.h>', '#include <gdiplus.h>\n#include <d3d11.h>\n#include <dxgi1_2.h>\n#pragma comment(lib, "d3d11.lib")\n#pragma comment(lib, "dxgi.lib")');

// 2. Wrap the old function
code = code.replace('std::string CaptureScreenToJPEG(int quality, int maxWidth, int maxHeight) {', 'std::string CaptureScreenToJPEG_GDI(int quality, int maxWidth, int maxHeight) {');

// 3. Append the DXGI implementation
let dxgiImpl = `
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

    Bitmap* pBitmap = new Bitmap(desc.Width, desc.Height, map.RowPitch, PixelFormat32bppARGB, (BYTE*)map.pData);
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
    return CaptureScreenToJPEG_DXGI(quality, maxWidth, maxHeight);
}

DWORD WINAPI ScreenshotStreamThread(LPVOID lpParam) {
`;

code = code.replace('DWORD WINAPI ScreenshotStreamThread(LPVOID lpParam) {', dxgiImpl);

// 4. Update the Stop method to cleanup
code = code.replace('CloseHandle(g_streamThread);', 'CloseHandle(g_streamThread);\n        CleanupDXGI();');

fs.writeFileSync('screen_capture.cpp', code, 'utf8');
console.log('Rewritten screen_capture.cpp to use DXGI');
