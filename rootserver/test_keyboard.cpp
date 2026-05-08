#include <windows.h>
#include <iostream>
int main() { Sleep(2000); INPUT input[2] = {0}; input[0].type = INPUT_KEYBOARD; input[0].ki.wVk = 65; input[1].type = INPUT_KEYBOARD; input[1].ki.wVk = 65; input[1].ki.dwFlags = KEYEVENTF_KEYUP; SendInput(2, input, sizeof(INPUT)); return 0; }
