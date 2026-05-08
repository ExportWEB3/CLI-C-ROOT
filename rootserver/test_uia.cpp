#include <windows.h>
#include <uiautomation.h>
int main() {
    IUIAutomation* pAutomation = NULL;
    CoCreateInstance(CLSID_CUIAutomation, NULL, CLSCLS_INPROC_SERVER, IID_IUIAutomation, (void**)&pAutomation);
    return 0;
}
