import { useState, useCallback, useEffect } from 'react'
import { useToast } from './Toast'
import Modal from './Modal'

interface ProcessInfo {
  pid: number
  name: string
  memory: number
  architecture: string
  username: string
  path: string
  priority: number
}

interface ProcessManagerProps {
  clientId?: string
  onSendCommand: (command: string) => void
  processes: ProcessInfo[]
}

const PRIORITY_CLASSES = [
  { value: 64,  label: 'IDLE',     color: '#888',    bg: '#88888822', desc: 'Lowest priority, only runs when system is idle' },
  { value: 32,  label: 'NORMAL',   color: '#27ae60', bg: '#27ae6033', desc: 'Default priority for most applications' },
  { value: 128, label: 'HIGH',     color: '#f39c12', bg: '#f39c1233', desc: 'Time-critical tasks, can slow down system' },
  { value: 256, label: 'REALTIME', color: '#e74c3c', bg: '#e74c3c33', desc: 'Highest priority, can cause system instability' },
] as const;

function getPriorityInfo(value: number) {
  if (value === 0) return null;
  return PRIORITY_CLASSES.find(p => p.value === value) || { 
    value: value, 
    label: `UNKNOWN (${value})`, 
    color: '#888', 
    bg: '#88888822', 
    desc: 'Unknown priority class' 
  };
}

export default function ProcessManager({ onSendCommand, processes }: ProcessManagerProps) {
  const toast = useToast();
  const [showMenu, setShowMenu] = useState<{ x: number; y: number; pid: number; name: string } | null>(null)
  const [priorityModal, setPriorityModal] = useState<{ pid: number; name: string } | null>(null)
  // Track process status: 'killed' or 'suspended' by PID
  const [processStatus, setProcessStatus] = useState<Record<number, 'killed' | 'suspended'>>({})

  const handleContextMenu = (e: React.MouseEvent, process: ProcessInfo) => {
    e.preventDefault()
    setShowMenu({ x: e.clientX, y: e.clientY, pid: process.pid, name: process.name })
  }

  const handleAction = useCallback((action: string) => {
    if (!showMenu) return
    const pid = showMenu.pid
    const name = showMenu.name
    setShowMenu(null)

    const actionLabels: Record<string, string> = {
      'process_kill': 'Kill',
      'process_suspend': 'Suspend',
      'process_resume': 'Resume',
    }
    const label = actionLabels[action] || action

    onSendCommand(`${action} ${pid}`)
    toast.info(`${label} command sent`, `${name} (PID ${pid})`, 3000)

    // Track status locally for immediate visual feedback
    if (action === 'process_kill') {
      setProcessStatus(prev => ({ ...prev, [pid]: 'killed' }))
    } else if (action === 'process_suspend') {
      setProcessStatus(prev => ({ ...prev, [pid]: 'suspended' }))
    } else if (action === 'process_resume') {
      setProcessStatus(prev => {
        const next = { ...prev }
        delete next[pid]
        return next
      })
    }

    // Auto-refresh process list after a short delay
    setTimeout(() => {
      onSendCommand('PROCESS_LIST')
    }, 1500)
  }, [showMenu, onSendCommand, toast])

  const handlePriority = useCallback(() => {
    if (!showMenu) return
    setPriorityModal({ pid: showMenu.pid, name: showMenu.name })
    setShowMenu(null)
  }, [showMenu])

  const applyPriority = useCallback((value: number) => {
    if (!priorityModal) return
    onSendCommand(`process_priority ${priorityModal.pid} ${value}`)
    const label = PRIORITY_CLASSES.find(p => p.value === value)?.label || String(value)
    toast.info('Priority command sent', `${priorityModal.name} → ${label}`, 3000)
    setPriorityModal(null)

    // Auto-refresh
    setTimeout(() => {
      onSendCommand('PROCESS_LIST')
    }, 1500)
  }, [priorityModal, onSendCommand, toast])

  // Clean up stale processStatus entries when process list refreshes
  // (killed processes that no longer appear should lose their tag)
  useEffect(() => {
    const activePids = new Set(processes.map(p => p.pid))
    setProcessStatus(prev => {
      const next = { ...prev }
      let changed = false
      for (const pid of Object.keys(next)) {
        if (!activePids.has(Number(pid))) {
          delete next[Number(pid)]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [processes])

  const formatMemory = (kb: number) => {
    if (kb < 1024) return `${kb} KB`
    return `${(kb / 1024).toFixed(1)} MB`
  }

  return (
    <div className='w-full h-full' style={{ display: 'flex', flexDirection: 'column' }}>
      <div className='w-full h-10' style={{ borderBottom: '1px solid #444' }}>
        <h2 style={{ margin: 0, fontSize: '18px' }}>Process Manager ({processes.length} processes)</h2>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#1a1a1a' }}>
              <th style={{ padding: '12px', textAlign: 'left' }}>PID</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Name</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Priority</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Username</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>Memory</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Arch</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Path</th>
            </tr>
          </thead>
          <tbody>
            {processes.map((process) => {
              const prio = getPriorityInfo(process.priority);
              return (
                <tr 
                  key={process.pid}
                  style={{ borderBottom: '1px solid #333' }}
                  onContextMenu={(e) => handleContextMenu(e, process)}
                >
                  <td style={{ padding: '12px' }}>{process.pid}</td>
                  <td style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span title={process.path}>{process.name}</span>
                      {processStatus[process.pid] === 'killed' && (
                        <span style={{
                          display: 'inline-block',
                          padding: '1px 6px',
                          borderRadius: '3px',
                          fontSize: '10px',
                          fontWeight: 700,
                          background: '#e74c3c33',
                          color: '#e74c3c',
                          border: '1px solid #e74c3c44',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}>
                          STOPPED
                        </span>
                      )}
                      {processStatus[process.pid] === 'suspended' && (
                        <span style={{
                          display: 'inline-block',
                          padding: '1px 6px',
                          borderRadius: '3px',
                          fontSize: '10px',
                          fontWeight: 700,
                          background: '#f39c1233',
                          color: '#f39c12',
                          border: '1px solid #f39c1244',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}>
                          SUSPENDED
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '12px' }}>
                    {prio ? (
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: prio.bg,
                        color: prio.color,
                        border: `1px solid ${prio.color}44`,
                      }}>
                        {prio.label}
                      </span>
                    ) : (
                      <span style={{ color: '#666', fontSize: '11px' }}>N/A</span>
                    )}
                  </td>
                  <td style={{ padding: '12px' }}>{process.username}</td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>{formatMemory(process.memory)}</td>
                  <td style={{ padding: '12px' }}>{process.architecture}</td>
                  <td style={{ padding: '12px', fontSize: '12px', color: '#aaa' }} title={process.path}>
                    {process.path.split('\\').pop()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Right-click context menu */}
      {showMenu && (
        <div style={{
          position: 'fixed',
          left: `${showMenu.x}px`,
          top: `${showMenu.y}px`,
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(71, 85, 105, 0.4)',
          borderRadius: '8px',
          padding: '6px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
          zIndex: 1000,
          minWidth: '180px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px'
        }}>
          <button
            onClick={() => handleAction('process_kill')}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              textAlign: 'left',
              color: '#f87171',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.target as HTMLButtonElement).style.background = 'rgba(239, 68, 68, 0.15)'}
            onMouseLeave={(e) => (e.target as HTMLButtonElement).style.background = 'transparent'}
          >
            Kill Process
          </button>
          {processStatus[showMenu.pid] !== 'suspended' && (
            <button
              onClick={() => handleAction('process_suspend')}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                borderRadius: '4px',
                textAlign: 'left',
                color: '#d97706',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => (e.target as HTMLButtonElement).style.background = 'rgba(217, 119, 6, 0.15)'}
              onMouseLeave={(e) => (e.target as HTMLButtonElement).style.background = 'transparent'}
            >
              Suspend Process
            </button>
          )}
          {processStatus[showMenu.pid] === 'suspended' && (
            <button
              onClick={() => handleAction('process_resume')}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                borderRadius: '4px',
                textAlign: 'left',
                color: '#10b981',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => (e.target as HTMLButtonElement).style.background = 'rgba(16, 185, 129, 0.15)'}
              onMouseLeave={(e) => (e.target as HTMLButtonElement).style.background = 'transparent'}
            >
              Resume Process
            </button>
          )}
          <div style={{ height: '1px', background: 'rgba(71, 85, 105, 0.4)', margin: '4px 2px' }} />
          <button
            onClick={handlePriority}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              textAlign: 'left',
              color: '#cbd5e1',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.target as HTMLButtonElement).style.background = 'rgba(71, 85, 105, 0.25)'}
            onMouseLeave={(e) => (e.target as HTMLButtonElement).style.background = 'transparent'}
          >
            Set Priority
          </button>
        </div>
      )}

      {/* Overlay to close context menu */}
      {showMenu && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999
          }}
          onClick={() => setShowMenu(null)}
        />
      )}

      {/* Priority Modal */}
      <Modal
        open={!!priorityModal}
        onClose={() => setPriorityModal(null)}
        title={`Set Priority - ${priorityModal?.name || ''} (PID ${priorityModal?.pid || ''})`}
        width="480px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {PRIORITY_CLASSES.map(pc => (
            <button
              key={pc.value}
              onClick={() => applyPriority(pc.value)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                background: '#2a2a2a',
                border: '1px solid #444',
                borderRadius: '8px',
                cursor: 'pointer',
                color: '#fff',
                textAlign: 'left',
                transition: 'all 0.15s',
              } as React.CSSProperties}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#333';
                e.currentTarget.style.borderColor = '#666';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#2a2a2a';
                e.currentTarget.style.borderColor = '#444';
              }}
            >
              <div>
                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>{pc.label}</div>
                <div style={{ fontSize: '12px', color: '#aaa' }}>{pc.desc}</div>
              </div>
              <div style={{
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: 600,
                background: pc.bg,
                color: pc.color,
              }}>
                {pc.value}
              </div>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  )
}
