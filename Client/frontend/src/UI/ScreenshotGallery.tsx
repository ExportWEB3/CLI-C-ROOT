import { useMemo, useState } from 'react'
import { Button } from './Button'

export interface ScreenshotItem {
  id: number
  url: string
  timestamp: string
  clientId: string
  imageSize?: number
  isStream?: boolean
}

export interface ScreenshotGalleryProps {
  screenshots: ScreenshotItem[]
  onRefresh?: () => void | Promise<void>
  onDelete?: (item: ScreenshotItem) => void | Promise<void>
  onExport?: (item: ScreenshotItem) => void
  captureScreenshot?: () => void | Promise<void>
  className?: string
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

export default function ScreenshotGallery({ screenshots, onRefresh, onDelete, onExport, captureScreenshot, className }: ScreenshotGalleryProps) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<ScreenshotItem | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [deletingItems, setDeletingItems] = useState<Set<number>>(new Set())

  const sortedScreenshots = useMemo(() => {
    return [...screenshots].sort((left, right) => {
      return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
    })
  }, [screenshots])

  const handleDownload = (item: ScreenshotItem) => {
    const anchor = document.createElement('a')
    anchor.href = item.url
    anchor.download = `screenshot-${item.clientId}-${new Date(item.timestamp).getTime()}.png`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  const handleRefresh = async () => {
    if (!onRefresh) return
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleCaptureScreenshot = async () => {
    if (!captureScreenshot) return
    setIsCapturing(true)
    try {
      await captureScreenshot()
    } finally {
      setTimeout(() => setIsCapturing(false), 1000)
    }
  }

  const handleDelete = async (item: ScreenshotItem) => {
    if (!onDelete) return
    
    setDeletingItems((prev) => {
      const next = new Set(prev)
      next.add(item.id)
      return next
    })
    try {
      await onDelete(item)
    } finally {
      setDeletingItems((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    }
  }

  return (
    <section className={`panel p-4 ${className ?? ''}`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-100">Screenshot Gallery</h3>
        <div className="flex items-center gap-2">
          {captureScreenshot ? (
            <Button
              type="button"
              onClick={() => void handleCaptureScreenshot()}
              isLoading={isCapturing}
              variant="primary"
              size="sm"
            >
              Capture Screen
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => void handleRefresh()}
            isLoading={isRefreshing}
            variant="secondary"
            size="sm"
          >
            Refresh
          </Button>
        </div>
      </div>

      {sortedScreenshots.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-8 text-center text-sm text-slate-400">
          No screenshots available.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedScreenshots.map((item) => (
            <article key={`${item.clientId}-${item.timestamp}-${item.url}`} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
              <button
                type="button"
                onClick={() => setSelectedScreenshot(item)}
                className="block w-full"
              >
                <img src={item.url} alt={`Screenshot from ${item.clientId}`} className="h-40 w-full object-cover" />
              </button>

              <div className="space-y-2 p-3">
                <p className="truncate text-xs text-slate-400">Client: {item.clientId}</p>
                <p className="text-xs text-slate-500">{formatTimestamp(item.timestamp)}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => handleDownload(item)}
                    variant="secondary"
                    size="sm"
                  >
                    Download
                  </Button>
                  {onExport ? (
                    <Button
                      type="button"
                      onClick={() => onExport(item)}
                      variant="secondary"
                      size="sm"
                    >
                      Export
                    </Button>
                  ) : null}
                  {onDelete ? (
                    <Button
                      type="button"
                      onClick={() => void handleDelete(item)}
                      isLoading={deletingItems.has(item.id)}
                      variant="danger"
                      size="sm"
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {selectedScreenshot ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"
          onClick={() => setSelectedScreenshot(null)}
          role="presentation"
        >
          <div
            className="max-h-full w-full max-w-6xl overflow-hidden rounded-xl border border-slate-700 bg-slate-900"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-100">{selectedScreenshot.clientId}</p>
                <p className="text-xs text-slate-400">{formatTimestamp(selectedScreenshot.timestamp)}</p>
                <p className="text-xs text-slate-500">
                  {selectedScreenshot.imageSize ? `${Math.round(selectedScreenshot.imageSize / 1024)} KB` : 'Unknown size'}
                  {selectedScreenshot.isStream ? ' • Stream' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => handleDownload(selectedScreenshot)}
                  variant="secondary"
                  size="sm"
                >
                  Download
                </Button>
                {onExport ? (
                  <Button
                    type="button"
                    onClick={() => onExport(selectedScreenshot)}
                    variant="secondary"
                    size="sm"
                  >
                    Export
                  </Button>
                ) : null}
                {onDelete ? (
                  <Button
                    type="button"
                    onClick={() => {
                      void handleDelete(selectedScreenshot)
                      setSelectedScreenshot(null)
                    }}
                    variant="danger"
                    size="sm"
                  >
                    Delete
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={() => setSelectedScreenshot(null)}
                  variant="ghost"
                  size="sm"
                >
                  Close
                </Button>
              </div>
            </div>

            <div className="max-h-[80vh] overflow-auto bg-slate-950 p-3">
              <img
                src={selectedScreenshot.url}
                alt={`Full screenshot from ${selectedScreenshot.clientId}`}
                className="mx-auto h-auto max-w-full rounded-md"
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
