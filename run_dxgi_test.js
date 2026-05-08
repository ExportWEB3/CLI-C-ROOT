const fs = require('fs');
const cp = require('child_process');

const cppCode = `
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <iostream>
#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")

int main() {
    ID3D11Device* d3dDevice = NULL;
    ID3D11DeviceContext* d3dContext = NULL;
    IDXGIOutputDuplication* deskDupl = NULL;

    HRESULT hr = D3D11CreateDevice(NULL, D3D_DRIVER_TYPE_HARDWARE, NULL, 0, NULL, 0, D3D11_SDK_VERSION, &d3dDevice, NULL, &d3dContext);
    if (FAILED(hr)) { std::cout << "D3D11CreateDevice failed" << std::endl; return 1; }

    IDXGIDevice* dxgiDevice = NULL;
    d3dDevice->QueryInterface(__uuidof(IDXGIDevice), (void**)&dxgiDevice);
    IDXGIAdapter* dxgiAdapter = NULL;
    dxgiDevice->GetParent(__uuidof(IDXGIAdapter), (void**)&dxgiAdapter);
    
    IDXGIOutput* dxgiOutput = NULL;
    hr = dxgiAdapter->EnumOutputs(0, &dxgiOutput);
    if (FAILED(hr)) { std::cout << "EnumOutputs failed: " << std::hex << hr << std::endl; return 1; }

    IDXGIOutput1* dxgiOutput1 = NULL;
    dxgiOutput->QueryInterface(__uuidof(IDXGIOutput1), (void**)&dxgiOutput1);
    hr = dxgiOutput1->DuplicateOutput(d3dDevice, &deskDupl);
    if (FAILED(hr)) { std::cout << "DuplicateOutput failed! hr=" << std::hex << hr << std::endl; return 1; }
    
    std::cout << "DXGI Initialization SUCCESS." << std::endl;
    
    DXGI_OUTDUPL_FRAME_INFO frameInfo;
    IDXGIResource* desktopResource = NULL;
    hr = deskDupl->AcquireNextFrame(1000, &frameInfo, &desktopResource);
    if (FAILED(hr)) { std::cout << "AcquireNextFrame failed: " << std::hex << hr << std::endl; return 1; }
    
    std::cout << "AcquireNextFrame SUCCESS. Frame resource ptr: " << desktopResource << std::endl;
    
    return 0;
}
`;

fs.writeFileSync('test_dxgi.cpp', cppCode);
try {
    cp.execSync('rootserver\\\\w64devkit\\\\w64devkit\\\\bin\\\\g++.exe test_dxgi.cpp -o test_dxgi.exe -ld3d11 -ldxgi', {stdio: 'inherit'});
    cp.execSync('test_dxgi.exe', {stdio: 'inherit'});
} catch(e) {
    console.error(e.message);
}
