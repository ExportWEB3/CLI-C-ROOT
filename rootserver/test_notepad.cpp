#include <windows.h>
int main() { Sleep(3000); INPUT ip = {0}; ip.type = INPUT_KEYBOARD; ip.ki.wVk = 65; SendInput(1, &ip, sizeof(INPUT)); ip.ki.dwFlags = KEYEVENTF_KEYUP; SendInput(1, &ip, sizeof(INPUT)); return 0; }
