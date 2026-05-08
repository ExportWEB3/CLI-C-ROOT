import { useEffect, useMemo, useState } from 'react'
import { Heading, Input, SectionTitle, Textarea, Button } from './index'

export interface KeylogViewerProps {
  keylogData: string
  onRefresh: () => void | Promise<void>
  className?: string
  cleanData?: string
}

const timestampPrefixRegex = /^\s*(\[[^\]]+\]|\d{4}-\d{2}-\d{2}[T\s][^\s]+)\s*[:\-]?\s*/

function stripTimestampPrefix(line: string): string {
  return line.replace(timestampPrefixRegex, '')
}

function formatNowFileSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export default function KeylogViewer({ keylogData, onRefresh, className, cleanData }: KeylogViewerProps) {
  const [searchValue, setSearchValue] = useState('')
  const [showTimestamps, setShowTimestamps] = useState(true)
  const [showClean, setShowClean] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isCopying, setIsCopying] = useState(false)

  const sourceData = showClean && cleanData ? cleanData : keylogData

  const displayedData = useMemo(() => {
    const lines = sourceData.split(/\r?\n/)
    const normalizedSearch = searchValue.trim().toLowerCase()

    const processedLines = lines.map((line) => (showTimestamps ? line : stripTimestampPrefix(line)))

    if (!normalizedSearch) {
      return processedLines.join('\n')
    }

    return processedLines.filter((line) => line.toLowerCase().includes(normalizedSearch)).join('\n')
  }, [sourceData, searchValue, showTimestamps])

  useEffect(() => {
    if (!autoRefresh) return

    const interval = window.setInterval(() => {
      void onRefresh()
    }, 5000)

    return () => {
      window.clearInterval(interval)
    }
  }, [autoRefresh, onRefresh])

  const handleCopy = async () => {
    setIsCopying(true)
    try {
      await navigator.clipboard.writeText(displayedData)
    } finally {
      setTimeout(() => setIsCopying(false), 500)
    }
  }

  const handleDownload = () => {
    const blob = new Blob([displayedData], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `keylog-${formatNowFileSuffix()}.txt`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)

    URL.revokeObjectURL(url)
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <section className={`panel p-4 ${className ?? ''}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Heading>Keylog Viewer</Heading>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => void handleRefresh()}
            isLoading={isRefreshing}
            variant="primary"
            size="sm"
          >
            Refresh
          </Button>
          <Button
            type="button"
            onClick={() => void handleCopy()}
            isLoading={isCopying}
            variant="secondary"
            size="sm"
          >
            Copy
          </Button>
          <Button
            type="button"
            onClick={handleDownload}
            variant="secondary"
            size="sm"
          >
            Download txt
          </Button>
        </div>
      </div>

      <div className="mb-3 grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
        <Input
          type="text"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="Search keylog..."
        />

        <label className="inline-flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={showTimestamps}
            onChange={(event) => setShowTimestamps(event.target.checked)}
            className="size-4 rounded border-slate-600 bg-slate-900 text-brand-600 focus:ring-brand-500"
          />
          Show timestamps
        </label>

        {cleanData && (
          <label className="inline-flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showClean}
              onChange={(event) => setShowClean(event.target.checked)}
              className="size-4 rounded border-slate-600 bg-slate-900 text-brand-600 focus:ring-brand-500"
            />
            Show clean
          </label>
        )}

        <label className="inline-flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
            className="size-4 rounded border-slate-600 bg-slate-900 text-brand-600 focus:ring-brand-500"
          />
          Auto-refresh
        </label>
      </div>

      <SectionTitle className="mb-2">Captured Keys</SectionTitle>

      <Textarea
        value={displayedData}
        readOnly
        className="min-h-80 font-mono text-xs leading-relaxed"
      />
    </section>
  )
}
