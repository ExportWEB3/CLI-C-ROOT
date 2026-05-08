import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBridgeWebSocket } from '../../hooks/BridgeWebSocketProvider'
import { useDatabaseQuery, type DatabaseQueryParams } from '../../hooks/useDatabaseQuery'
import ScreenshotGallery, { type ScreenshotItem } from '../../UI/ScreenshotGallery'
import ClientFilter from '../../UI/ClientFilter'
import type { ClientInfo } from '../../UI/ClientFilter'
import { useDashboardStore } from '../../store/dashboardStore.ts'

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
