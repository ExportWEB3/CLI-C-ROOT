#include "hidden_desktop.h"
#include <iostream>
#include <wtsapi32.h>
#include <sddl.h>
#include <aclapi.h>

struct SwitchParams {
    HDESK hDesktop;
    HANDLE hEvent;
    bool success;
};

DWORD WINAPI SwitchDesktopThread(LPVOID lpParam) {
    SwitchParams* p = (SwitchParams*)lpParam;
    p->success = (SetThreadDesktop(p->hDesktop) != 0);
    SetEvent(p->hEvent);
    return 0;
}

#pragma comment(lib, "wtsapi32.lib")
#pragma comment(lib, "advapi32.lib")

// Global state
static HDESK g_hHiddenDesktop = NULL;
static HDESK g_hDefaultDesktop = NULL;
static DesktopMode g_currentMode = DESKTOP_VISIBLE;
static HWINSTA g_hOriginalStation = NULL;
static HWINSTA g_hHiddenStation = NULL;
static const char* STEALTH_DESKTOP_NAME = "StealthDesktop";
static const char* STEALTH_STATION_NAME = "StealthStation";

// Forward declarations
static bool CreateHiddenWindowStation();
static bool SetDesktopACL(HDESK hDesktop, const char* name);
static bool AddInteractiveUsersACL(HDESK hDesktop);

bool InitHiddenDesktop() {
    // Save handle to the current (default) desktop
    g_hDefaultDesktop = GetThreadDesktop(GetCurrentThreadId());
    if (!g_hDefaultDesktop) {
        std::cerr << "[HIDDEN] Failed to get default desktop handle, error: " << GetLastError() << "\n";
        return false;
    }

    // Save current window station
    g_hOriginalStation = GetProcessWindowStation();
    if (!g_hOriginalStation) {
        std::cerr << "[HIDDEN] Failed to get current window station, error: " << GetLastError() << "\n";
        return false;
    }

    // Create a hidden window station first (isolates the desktop better)
    if (!CreateHiddenWindowStation()) {
        std::cerr << "[HIDDEN] Failed to create hidden window station, trying default station\n";
    }

    // Create the hidden desktop on the default window station
    g_hHiddenDesktop = CreateDesktopA(
        STEALTH_DESKTOP_NAME,
        NULL,
        NULL,
        0,
        DESKTOP_CREATEWINDOW | DESKTOP_SWITCHDESKTOP | DESKTOP_WRITEOBJECTS | DESKTOP_ENUMERATE,
        NULL
    );

    if (!g_hHiddenDesktop) {
        DWORD err = GetLastError();
        if (err == ERROR_ALREADY_EXISTS) {
            g_hHiddenDesktop = OpenDesktopA(
                STEALTH_DESKTOP_NAME,
                0,
                FALSE,
                DESKTOP_CREATEWINDOW | DESKTOP_SWITCHDESKTOP | DESKTOP_WRITEOBJECTS | DESKTOP_ENUMERATE
            );
        }
    }

    if (!g_hHiddenDesktop) {
        std::cerr << "[HIDDEN] Failed to create/open hidden desktop, error: " << GetLastError() << "\n";
        return false;
    }

    // Set ACL on the hidden desktop so our process can access it
    SetDesktopACL(g_hHiddenDesktop, STEALTH_DESKTOP_NAME);
    
    // Also grant access to interactive users (so user-launched processes can work)
    AddInteractiveUsersACL(g_hHiddenDesktop);

    std::cout << "[HIDDEN] Hidden desktop '" << STEALTH_DESKTOP_NAME << "' initialized\n";
    return true;
}

static bool CreateHiddenWindowStation() {
    // Create a new window station for isolation
    SECURITY_ATTRIBUTES sa;
    sa.nLength = sizeof(sa);
    sa.lpSecurityDescriptor = NULL;
    sa.bInheritHandle = FALSE;

    g_hHiddenStation = CreateWindowStationA(
        STEALTH_STATION_NAME,
        0,
        WINSTA_CREATEDESKTOP | WINSTA_ENUMDESKTOPS | WINSTA_READATTRIBUTES | WINSTA_WRITEATTRIBUTES |
        WINSTA_ACCESSCLIPBOARD | WINSTA_ACCESSGLOBALATOMS | WINSTA_EXITWINDOWS,
        &sa
    );

    if (!g_hHiddenStation) {
        DWORD err = GetLastError();
        if (err == ERROR_ALREADY_EXISTS) {
            g_hHiddenStation = OpenWindowStationA(
                STEALTH_STATION_NAME,
                FALSE,
                WINSTA_CREATEDESKTOP | WINSTA_ENUMDESKTOPS | WINSTA_READATTRIBUTES | WINSTA_WRITEATTRIBUTES |
                WINSTA_ACCESSCLIPBOARD | WINSTA_ACCESSGLOBALATOMS | WINSTA_EXITWINDOWS
            );
        }
        if (!g_hHiddenStation) {
            std::cerr << "[HIDDEN] Failed to create/open hidden station, error: " << GetLastError() << "\n";
            return false;
        }
    }

    std::cout << "[HIDDEN] Hidden window station '" << STEALTH_STATION_NAME << "' created\n";
    return true;
}

static bool SetDesktopACL(HDESK hDesktop, const char* name) {
    // Get the current process token to grant access
    HANDLE hToken = NULL;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &hToken)) {
        return false;
    }

    // Get the user SID from the token
    DWORD tokenInfoLen = 0;
    GetTokenInformation(hToken, TokenUser, NULL, 0, &tokenInfoLen);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER) {
        CloseHandle(hToken);
        return false;
    }

    std::vector<BYTE> tokenInfo(tokenInfoLen);
    TOKEN_USER* pTokenUser = reinterpret_cast<TOKEN_USER*>(tokenInfo.data());
    if (!GetTokenInformation(hToken, TokenUser, pTokenUser, tokenInfoLen, &tokenInfoLen)) {
        CloseHandle(hToken);
        return false;
    }

    CloseHandle(hToken);

    // Build a security descriptor that grants full access to the user
    PSECURITY_DESCRIPTOR pSD = (PSECURITY_DESCRIPTOR)LocalAlloc(LPTR, SECURITY_DESCRIPTOR_MIN_LENGTH);
    if (!pSD) return false;

    if (!InitializeSecurityDescriptor(pSD, SECURITY_DESCRIPTOR_REVISION)) {
        LocalFree(pSD);
        return false;
    }

    // Create ACL with one ACE granting GENERIC_ALL to the user
    DWORD aclSize = sizeof(ACL) + sizeof(ACCESS_ALLOWED_ACE) + GetLengthSid(pTokenUser->User.Sid) - sizeof(DWORD);
    PACL pACL = (PACL)LocalAlloc(LPTR, aclSize);
    if (!pACL) {
        LocalFree(pSD);
        return false;
    }

    if (!InitializeAcl(pACL, aclSize, ACL_REVISION)) {
        LocalFree(pSD);
        LocalFree(pACL);
        return false;
    }

    if (!AddAccessAllowedAce(pACL, ACL_REVISION, GENERIC_ALL, pTokenUser->User.Sid)) {
        LocalFree(pSD);
        LocalFree(pACL);
        return false;
    }

    if (!SetSecurityDescriptorDacl(pSD, TRUE, pACL, FALSE)) {
        LocalFree(pSD);
        LocalFree(pACL);
        return false;
    }

    // Set the desktop security
    SECURITY_INFORMATION daclInfo = DACL_SECURITY_INFORMATION;
    BOOL result = SetUserObjectSecurity(hDesktop, &daclInfo, pSD);

    LocalFree(pSD);
    LocalFree(pACL);

    return result != 0;
}

// Grant access to the interactive users group (S-1-5-4) and authenticated users (S-1-5-11)
// This ensures processes launched by the logged-in user can also access the hidden desktop
static bool AddInteractiveUsersACL(HDESK hDesktop) {
    PSECURITY_DESCRIPTOR pSD = NULL;
    PACL pOldDacl = NULL;
    PACL pNewDacl = NULL;
    PSID pInteractiveSid = NULL;
    PSID pAuthUsersSid = NULL;
    bool result = false;

    // Create well-known SIDs
    SID_IDENTIFIER_AUTHORITY ntAuthority = SECURITY_NT_AUTHORITY;
    
    if (!AllocateAndInitializeSid(&ntAuthority, 1, SECURITY_INTERACTIVE_RID,
                                  0, 0, 0, 0, 0, 0, 0, &pInteractiveSid)) {
        return false;
    }
    
    if (!AllocateAndInitializeSid(&ntAuthority, 1, SECURITY_AUTHENTICATED_USER_RID,
                                  0, 0, 0, 0, 0, 0, 0, &pAuthUsersSid)) {
        FreeSid(pInteractiveSid);
        return false;
    }

    // Get existing security descriptor
    DWORD sdLen = 0;
    SECURITY_INFORMATION daclInfo = DACL_SECURITY_INFORMATION;
    GetUserObjectSecurity(hDesktop, &daclInfo, NULL, 0, &sdLen);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER) {
        FreeSid(pInteractiveSid);
        FreeSid(pAuthUsersSid);
        return false;
    }

    pSD = LocalAlloc(LPTR, sdLen);
    if (!pSD) {
        FreeSid(pInteractiveSid);
        FreeSid(pAuthUsersSid);
        return false;
    }

    if (!GetUserObjectSecurity(hDesktop, &daclInfo, pSD, sdLen, &sdLen)) {
        LocalFree(pSD);
        FreeSid(pInteractiveSid);
        FreeSid(pAuthUsersSid);
        return false;
    }

    // Get existing DACL
    BOOL daclPresent = FALSE;
    BOOL daclDefaulted = FALSE;
    if (!GetSecurityDescriptorDacl(pSD, &daclPresent, &pOldDacl, &daclDefaulted)) {
        LocalFree(pSD);
        FreeSid(pInteractiveSid);
        FreeSid(pAuthUsersSid);
        return false;
    }

    // Create new ACL with existing entries plus our new ACEs
    ACL_SIZE_INFORMATION aclInfo;
    aclInfo.AceCount = 0;
    aclInfo.AclBytesInUse = 0;
    aclInfo.AclBytesFree = 0;
    
    if (pOldDacl) {
        GetAclInformation(pOldDacl, &aclInfo, sizeof(aclInfo), AclSizeInformation);
    }

    DWORD newAclSize = aclInfo.AclBytesInUse + sizeof(ACL) +
                       sizeof(ACCESS_ALLOWED_ACE) + GetLengthSid(pInteractiveSid) - sizeof(DWORD) +
                       sizeof(ACCESS_ALLOWED_ACE) + GetLengthSid(pAuthUsersSid) - sizeof(DWORD);

    pNewDacl = (PACL)LocalAlloc(LPTR, newAclSize);
    if (!pNewDacl) {
        LocalFree(pSD);
        FreeSid(pInteractiveSid);
        FreeSid(pAuthUsersSid);
        return false;
    }

    if (!InitializeAcl(pNewDacl, newAclSize, ACL_REVISION)) {
        LocalFree(pSD);
        LocalFree(pNewDacl);
        FreeSid(pInteractiveSid);
        FreeSid(pAuthUsersSid);
        return false;
    }

    // Copy existing ACEs
    if (pOldDacl) {
        for (DWORD i = 0; i < aclInfo.AceCount; i++) {
            LPVOID pAce;
            if (GetAce(pOldDacl, i, &pAce)) {
                ACE_HEADER* aceHeader = (ACE_HEADER*)pAce;
                AddAce(pNewDacl, ACL_REVISION, MAXDWORD, pAce, aceHeader->AceSize);
            }
        }
    }

    // Add interactive users ACE (GENERIC_READ + DESKTOP_SWITCHDESKTOP + DESKTOP_WRITEOBJECTS)
    AddAccessAllowedAce(pNewDacl, ACL_REVISION, 
        GENERIC_READ | GENERIC_EXECUTE | DESKTOP_SWITCHDESKTOP | DESKTOP_WRITEOBJECTS,
        pInteractiveSid);

    // Add authenticated users ACE
    AddAccessAllowedAce(pNewDacl, ACL_REVISION,
        GENERIC_READ | GENERIC_EXECUTE,
        pAuthUsersSid);

    // Create new security descriptor with the merged DACL
    PSECURITY_DESCRIPTOR pNewSD = (PSECURITY_DESCRIPTOR)LocalAlloc(LPTR, SECURITY_DESCRIPTOR_MIN_LENGTH);
    if (pNewSD) {
        InitializeSecurityDescriptor(pNewSD, SECURITY_DESCRIPTOR_REVISION);
        SetSecurityDescriptorDacl(pNewSD, TRUE, pNewDacl, FALSE);
        SECURITY_INFORMATION daclInfo = DACL_SECURITY_INFORMATION;
        result = (SetUserObjectSecurity(hDesktop, &daclInfo, pNewSD) != 0);
        LocalFree(pNewSD);
    }

    LocalFree(pSD);
    LocalFree(pNewDacl);
    FreeSid(pInteractiveSid);
    FreeSid(pAuthUsersSid);
    return result;
}

bool SwitchActiveDesktop(DesktopMode mode) {
    if (mode == g_currentMode) {
        return true;
    }

    HDESK hTargetDesktop = NULL;
    HWINSTA hTargetStation = NULL;
    const char* modeName = NULL;

    if (mode == DESKTOP_STEALTH) {
        hTargetDesktop = g_hHiddenDesktop;
        hTargetStation = g_hHiddenStation ? g_hHiddenStation : g_hOriginalStation;
        modeName = "STEALTH";
    } else {
        hTargetDesktop = g_hDefaultDesktop;
        hTargetStation = g_hOriginalStation;
        modeName = "VISIBLE";
    }

    if (!hTargetDesktop) {
        std::cerr << "[HIDDEN] Target desktop handle is NULL\n";
        return false;
    }

    // Step 1: Switch window station first (if we have a hidden one)
    if (hTargetStation && hTargetStation != GetProcessWindowStation()) {
        if (!SetProcessWindowStation(hTargetStation)) {
            std::cerr << "[HIDDEN] SetProcessWindowStation to " << modeName << " failed, error: " << GetLastError() << "\n";
        } else {
            std::cout << "[HIDDEN] Switched process window station to " << modeName << "\n";
        }
    }

    // Step 2: SetThreadDesktop on the main thread directly
    // This works if the thread doesn't own windows or hooks
    if (!SetThreadDesktop(hTargetDesktop)) {
        DWORD err = GetLastError();
        std::cerr << "[HIDDEN] SetThreadDesktop to " << modeName << " failed (direct), error: " << err << "\n";
        
        // Fallback: create a temporary thread to do the switch
        HANDLE hSwitchEvent = CreateEventA(NULL, FALSE, FALSE, NULL);
        if (!hSwitchEvent) {
            std::cerr << "[HIDDEN] Failed to create switch event\n";
            return false;
        }

        SwitchParams params = { hTargetDesktop, hSwitchEvent, false };

        HANDLE hSwitchThread = CreateThread(NULL, 0, SwitchDesktopThread, &params, 0, NULL);
        if (hSwitchThread) {
            WaitForSingleObject(hSwitchEvent, 3000);
            CloseHandle(hSwitchThread);

            if (!params.success) {
                std::cerr << "[HIDDEN] SetThreadDesktop to " << modeName << " failed (thread), error: " << GetLastError() << "\n";
                CloseHandle(hSwitchEvent);
                return false;
            }
        }
        CloseHandle(hSwitchEvent);
    }

    // Step 3: Try SwitchDesktop - this only works from a thread in the target window station
    // that has the DESKTOP_SWITCHDESKTOP access right
    if (!SwitchDesktop(hTargetDesktop)) {
        DWORD err = GetLastError();
        if (err == ERROR_ACCESS_DENIED) {
            std::cout << "[HIDDEN] SwitchDesktop to " << modeName << " denied (expected - using thread switch only)\n";
        } else {
            std::cerr << "[HIDDEN] SwitchDesktop to " << modeName << " failed, error: " << err << "\n";
        }
    }

    g_currentMode = mode;
    std::cout << "[HIDDEN] Switched to " << modeName << " desktop\n";
    return true;
}

bool LaunchOnActiveDesktop(const char* appPath, const char* args) {
    STARTUPINFOA si = { sizeof(si) };
    PROCESS_INFORMATION pi;

    // Set the desktop for the new process based on current mode
    if (g_currentMode == DESKTOP_STEALTH) {
        if (g_hHiddenStation) {
            std::string desktopStr = std::string(STEALTH_STATION_NAME) + "\\" + STEALTH_DESKTOP_NAME;
            si.lpDesktop = const_cast<char*>(desktopStr.c_str());
        } else {
            si.lpDesktop = const_cast<char*>(STEALTH_DESKTOP_NAME);
        }
    } else {
        si.lpDesktop = const_cast<char*>("WinSta0\\Default");
    }

    // Build command line
    std::string cmdLine;
    if (args) {
        cmdLine = std::string("\"") + appPath + "\" " + args;
    } else {
        cmdLine = std::string("\"") + appPath + "\"";
    }

    // Use DETACHED_PROCESS to avoid console window appearing
    if (!CreateProcessA(
        NULL,
        const_cast<char*>(cmdLine.c_str()),
        NULL,
        NULL,
        FALSE,
        DETACHED_PROCESS | CREATE_NO_WINDOW,
        NULL,
        NULL,
        &si,
        &pi
    )) {
        std::cerr << "[HIDDEN] Failed to launch process on active desktop, error: " << GetLastError() << "\n";
        return false;
    }

    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);

    std::cout << "[HIDDEN] Launched: " << appPath << " on "
              << (g_currentMode == DESKTOP_STEALTH ? "STEALTH" : "VISIBLE")
              << " desktop (PID: " << pi.dwProcessId << ")\n";
    return true;
}

bool LaunchOnHiddenDesktop(const char* appPath, const char* args) {
    STARTUPINFOA si = { sizeof(si) };
    PROCESS_INFORMATION pi;

    // Always launch on the hidden desktop
    if (g_hHiddenStation) {
        std::string desktopStr = std::string(STEALTH_STATION_NAME) + "\\" + STEALTH_DESKTOP_NAME;
        si.lpDesktop = const_cast<char*>(desktopStr.c_str());
    } else {
        si.lpDesktop = const_cast<char*>(STEALTH_DESKTOP_NAME);
    }

    // Build command line
    std::string cmdLine;
    if (args) {
        cmdLine = std::string("\"") + appPath + "\" " + args;
    } else {
        cmdLine = std::string("\"") + appPath + "\"";
    }

    // Use DETACHED_PROCESS to avoid console window appearing
    if (!CreateProcessA(
        NULL,
        const_cast<char*>(cmdLine.c_str()),
        NULL,
        NULL,
        FALSE,
        DETACHED_PROCESS | CREATE_NO_WINDOW,
        NULL,
        NULL,
        &si,
        &pi
    )) {
        std::cerr << "[HIDDEN] Failed to launch process on hidden desktop, error: " << GetLastError() << "\n";
        return false;
    }

    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);

    std::cout << "[HIDDEN] Launched: " << appPath << " on HIDDEN desktop (PID: " << pi.dwProcessId << ")\n";
    return true;
}

DesktopMode GetCurrentDesktopMode() {
    return g_currentMode;
}

const char* GetHiddenDesktopName() {
    return STEALTH_DESKTOP_NAME;
}

void CleanupHiddenDesktop() {
    if (g_hHiddenDesktop) {
        // Switch back to default desktop before closing
        if (g_currentMode == DESKTOP_STEALTH && g_hDefaultDesktop) {
            SetThreadDesktop(g_hDefaultDesktop);
            g_currentMode = DESKTOP_VISIBLE;
        }
        CloseDesktop(g_hHiddenDesktop);
        g_hHiddenDesktop = NULL;
        std::cout << "[HIDDEN] Hidden desktop cleaned up\n";
    }

    if (g_hHiddenStation) {
        CloseWindowStation(g_hHiddenStation);
        g_hHiddenStation = NULL;
        std::cout << "[HIDDEN] Hidden window station cleaned up\n";
    }
}
