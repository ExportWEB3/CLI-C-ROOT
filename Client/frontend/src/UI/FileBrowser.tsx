import { useMemo, useRef, useState, useCallback, type ReactNode } from 'react'
import { Button } from './Button'

export type FileSystemType = 'file' | 'folder'

export interface FileSystemNode {
  name: string
  path: string
  type: FileSystemType
  children?: FileSystemNode[]
}

export interface FileSystemEntry {
  name: string
  path: string
  type: FileSystemType
  size?: string
  modifiedAt?: string
}

export interface FileBrowserProps {
  tree: FileSystemNode[]
  entries: FileSystemEntry[]
  currentPath: string
  onNavigate: (path: string) => void
  onDownload: (filePath: string) => void
  onUpload: (targetPath: string, file: File) => void | Promise<void>
  onMkdir?: (parentPath: string, dirName: string) => void
  onTouch?: (parentPath: string, fileName: string) => void
  onDelete?: (filePath: string, isDirectory: boolean) => void
  onRename?: (oldPath: string, newName: string) => void
  onZip?: (path: string) => void
  onUnzip?: (zipPath: string, outputDir: string) => void
  onProperties?: (filePath: string) => void
  onPreview?: (filePath: string) => void
  className?: string
}

type SortField = 'name' | 'type' | 'size' | 'modified'
type SortDir = 'asc' | 'desc'

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized || '/'
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function getFileIcon(name: string, type: FileSystemType): ReactNode {
  if (type === 'folder') {
    return (
      <svg viewBox="0 0 24 24" className="size-4 text-amber-300" fill="currentColor" aria-hidden="true">
        <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-11Z" />
      </svg>
    )
  }
  
  const ext = name.split('.').pop()?.toLowerCase() || ''
  
  // Image files
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico'].includes(ext)) {
    return (
      <svg viewBox="0 0 24 24" className="size-4 text-green-400" fill="currentColor" aria-hidden="true">
        <path d="M6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6H6Z" />
        <path d="M14 3v6h6" className="text-slate-900" fill="currentColor" />
        <circle cx="9" cy="10" r="1.5" fill="currentColor" />
        <path d="M5 18l4-6 3 4 2-2 5 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    )
  }
  
  // Code files
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'cpp', 'c', 'h', 'java', 'cs', 'go', 'rs', 'rb', 'php'].includes(ext)) {
    return (
      <svg viewBox="0 0 24 24" className="size-4 text-emerald-400" fill="currentColor" aria-hidden="true">
        <path d="M6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6H6Z" />
        <path d="M14 3v6h6" className="text-slate-900" fill="currentColor" />
        <path d="M9 13l-2 2 2 2M15 13l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  
  // Archive files
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) {
    return (
      <svg viewBox="0 0 24 24" className="size-4 text-orange-400" fill="currentColor" aria-hidden="true">
        <path d="M6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6H6Z" />
        <path d="M14 3v6h6" className="text-slate-900" fill="currentColor" />
        <path d="M8 12h8M8 16h8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  
  // Document files
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'csv', 'rtf'].includes(ext)) {
    return (
      <svg viewBox="0 0 24 24" className="size-4 text-blue-400" fill="currentColor" aria-hidden="true">
        <path d="M6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6H6Z" />
        <path d="M14 3v6h6" className="text-slate-900" fill="currentColor" />
        <path d="M8 12h8M8 15h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  
  // Audio/Video
  if (['mp3', 'wav', 'flac', 'mp4', 'avi', 'mkv', 'mov', 'wmv'].includes(ext)) {
    return (
      <svg viewBox="0 0 24 24" className="size-4 text-purple-400" fill="currentColor" aria-hidden="true">
        <path d="M6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6H6Z" />
        <path d="M14 3v6h6" className="text-slate-900" fill="currentColor" />
        <path d="M10 12v4M14 11v6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  
  // Executable
  if (['exe', 'dll', 'msi', 'bat', 'cmd', 'ps1'].includes(ext)) {
    return (
      <svg viewBox="0 0 24 24" className="size-4 text-red-400" fill="currentColor" aria-hidden="true">
        <path d="M6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6H6Z" />
        <path d="M14 3v6h6" className="text-slate-900" fill="currentColor" />
        <path d="M9 12l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  
  // Default file icon
  return (
    <svg viewBox="0 0 24 24" className="size-4 text-sky-300" fill="currentColor" aria-hidden="true">
      <path d="M6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6H6Z" />
      <path d="M14 3v6h6" className="text-slate-900" fill="currentColor" />
    </svg>
  )
}

interface TreeNodeProps {
  node: FileSystemNode
  level: number
  currentPath: string
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onNavigate: (path: string) => void
}

function TreeNode({ node, level, currentPath, expandedPaths, onToggle, onNavigate }: TreeNodeProps) {
  const normalizedNodePath = normalizePath(node.path)
  const isCurrent = normalizePath(currentPath) === normalizedNodePath
  const hasChildren = node.type === 'folder' && Array.isArray(node.children) && node.children.length > 0
  const isExpanded = expandedPaths.has(normalizedNodePath)

  const paddingLeft = `${Math.max(level, 0) * 0.75 + 0.5}rem`

  return (
    <li>
      <div
        style={{ paddingLeft }}
        className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm transition ${
          isCurrent ? 'bg-brand-600/20 text-slate-100' : 'text-slate-300 hover:bg-slate-800/70 hover:text-slate-100'
        }`}
      >
        {node.type === 'folder' ? (
          <button
            type="button"
            onClick={() => {
              if (hasChildren) {
                onToggle(normalizedNodePath)
              }
            }}
            className="flex h-5 w-4 items-center justify-center text-xs text-slate-400 hover:text-slate-200"
            aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
          >
            {hasChildren ? (isExpanded ? '▾' : '▸') : '·'}
          </button>
        ) : (
          <span className="h-5 w-4" aria-hidden="true" />
        )}

        <button
          type="button"
          onClick={() => {
            if (node.type === 'folder') {
              onNavigate(normalizedNodePath)
            }
          }}
          className="flex min-w-0 items-center gap-2"
        >
          {getFileIcon(node.name, node.type)}
          <span className="truncate">{node.name}</span>
        </button>
      </div>

      {hasChildren && isExpanded ? (
        <ul className="mt-1 space-y-1">
          {node.children?.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              level={level + 1}
              currentPath={currentPath}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function renderPathBreadcrumbs(path: string, onNavigate: (path: string) => void): ReactNode {
  const normalized = normalizePath(path)
  const segments = normalized.split('/').filter(Boolean)

  const crumbs = [{ label: 'root', path: '/' }]
  let accumulated = ''

  for (const segment of segments) {
    accumulated += `/${segment}`
    crumbs.push({ label: segment, path: accumulated })
  }

  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
      {crumbs.map((crumb, index) => (
        <span key={crumb.path} className="inline-flex items-center gap-1">
          {index > 0 ? <span className="text-slate-500">/</span> : null}
          <button
            type="button"
            onClick={() => onNavigate(crumb.path)}
            className="rounded px-1 py-0.5 text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </nav>
  )
}

export default function FileBrowser({
  tree,
  entries,
  currentPath,
  onNavigate,
  onDownload,
  onUpload,
  onMkdir,
  onTouch,
  onDelete,
  onRename,
  onZip,
  onUnzip,
  onProperties,
  onPreview,
  className,
}: FileBrowserProps) {
  const normalizedPath = normalizePath(currentPath)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dropZoneRef = useRef<HTMLDivElement | null>(null)

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['/']))
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileSystemEntry | null } | null>(null)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [showNewFile, setShowNewFile] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set())
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ fileName: string; percent: number } | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<{ fileName: string; percent: number } | null>(null)

  const sortedEntries = useMemo(() => {
    return [...entries].sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'folder' ? -1 : 1
      }

      let cmp = 0
      switch (sortField) {
        case 'name':
          cmp = left.name.toLowerCase().localeCompare(right.name.toLowerCase())
          break
        case 'type':
          cmp = left.type.localeCompare(right.type)
          break
        case 'size': {
          const lSize = left.size ? parseFloat(left.size) : 0
          const rSize = right.size ? parseFloat(right.size) : 0
          cmp = lSize - rSize
          break
        }
        case 'modified':
          cmp = (left.modifiedAt || '').localeCompare(right.modifiedAt || '')
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [entries, sortField, sortDir])

  const [isUploading, setIsUploading] = useState<boolean>(false)
  const [downloadingFiles, setDownloadingFiles] = useState<Set<string>>(new Set())

  const handleTogglePath = (path: string) => {
    setExpandedPaths((previous) => {
      const next = new Set(previous)
      const normalized = normalizePath(path)

      if (next.has(normalized)) {
        next.delete(normalized)
      } else {
        next.add(normalized)
      }

      return next
    })
  }

  const handleOpenUpload = () => {
    fileInputRef.current?.click()
  }

  const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    setUploadProgress({ fileName: file.name, percent: 0 })
    try {
      // Simulate progress for UX
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => prev ? { ...prev, percent: Math.min(prev.percent + 10, 90) } : null)
      }, 200)
      await onUpload(normalizedPath, file)
      clearInterval(progressInterval)
      setUploadProgress({ fileName: file.name, percent: 100 })
      setTimeout(() => setUploadProgress(null), 1000)
    } finally {
      setIsUploading(false)
      event.target.value = ''
    }
  }

  const handleDownload = async (path: string) => {
    const fileName = path.split('\\').pop() || path.split('/').pop() || 'file'
    setDownloadingFiles((prev) => {
      const next = new Set(prev)
      next.add(path)
      return next
    })
    setDownloadProgress({ fileName, percent: 0 })
    const progressInterval = setInterval(() => {
      setDownloadProgress(prev => prev ? { ...prev, percent: Math.min(prev.percent + 15, 90) } : null)
    }, 300)
    try {
      await onDownload(path)
      clearInterval(progressInterval)
      setDownloadProgress({ fileName, percent: 100 })
      setTimeout(() => setDownloadProgress(null), 1000)
    } finally {
      setDownloadingFiles((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileSystemEntry) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, entry })
  }, [])

  const closeContextMenu = () => setContextMenu(null)

  const handleCreateFolder = () => {
    if (newItemName.trim() && onMkdir) {
      onMkdir(normalizedPath, newItemName.trim())
    }
    setShowNewFolder(false)
    setNewItemName('')
  }

  const handleCreateFile = () => {
    if (newItemName.trim() && onTouch) {
      onTouch(normalizedPath, newItemName.trim())
    }
    setShowNewFile(false)
    setNewItemName('')
  }

  const toggleSelect = (path: string) => {
    setSelectedEntries(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    
    for (const file of files) {
      setIsUploading(true)
      setUploadProgress({ fileName: file.name, percent: 0 })
      try {
        const progressInterval = setInterval(() => {
          setUploadProgress(prev => prev ? { ...prev, percent: Math.min(prev.percent + 10, 90) } : null)
        }, 200)
        await onUpload(normalizedPath, file)
        clearInterval(progressInterval)
        setUploadProgress({ fileName: file.name, percent: 100 })
        setTimeout(() => setUploadProgress(null), 1000)
      } finally {
        setIsUploading(false)
      }
    }
  }, [normalizedPath, onUpload])

  const SortHeader = ({ field, label, className: cl }: { field: SortField; label: string; className?: string }) => (
    <th
      className={`cursor-pointer px-3 py-2 font-medium select-none hover:text-slate-100 ${cl || ''}`}
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortField === field ? (
          <span className="text-xs">{sortDir === 'asc' ? '▲' : '▼'}</span>
        ) : (
          <span className="text-xs text-slate-600">⇅</span>
        )}
      </span>
    </th>
  )

  // Progress bar component
  const ProgressBar = ({ fileName, percent }: { fileName: string; percent: number }) => (
    <div className="mb-3 rounded-lg border border-slate-700 bg-slate-900/80 p-3">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="truncate text-slate-300 max-w-[200px]">{fileName}</span>
        <span className="text-slate-400">{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )

  return (
    <section className={`panel p-4 ${className ?? ''}`} onClick={closeContextMenu}>
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-100">Remote File Browser</h3>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" onClick={() => { setShowNewFolder(true); setNewItemName('') }} variant="secondary" size="sm">
            + Folder
          </Button>
          <Button type="button" onClick={() => { setShowNewFile(true); setNewItemName('') }} variant="secondary" size="sm">
            + File
          </Button>
          <Button type="button" onClick={handleOpenUpload} isLoading={isUploading} variant="primary" size="sm">
            Upload
          </Button>
          <Button type="button" onClick={() => onNavigate(normalizedPath)} variant="secondary" size="sm">
            Refresh
          </Button>
          {selectedEntries.size > 0 && (
            <>
              <Button
                type="button"
                onClick={() => {
                  if (onDelete) {
                    selectedEntries.forEach(path => {
                      const entry = entries.find(e => e.path === path)
                      if (entry) onDelete(path, entry.type === 'folder')
                    })
                  }
                  setSelectedEntries(new Set())
                }}
                variant="danger"
                size="sm"
              >
                Delete ({selectedEntries.size})
              </Button>
              <Button
                type="button"
                onClick={() => setSelectedEntries(new Set())}
                variant="secondary"
                size="sm"
              >
                Clear
              </Button>
            </>
          )}
        </div>
        <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => void handleUploadChange(event)} />
      </div>

      {/* Progress bars */}
      {uploadProgress && <ProgressBar fileName={uploadProgress.fileName} percent={uploadProgress.percent} />}
      {downloadProgress && <ProgressBar fileName={downloadProgress.fileName} percent={downloadProgress.percent} />}

      {/* New folder/file dialog */}
      {(showNewFolder || showNewFile) && (
        <div className="mb-3 rounded-lg border border-slate-700 bg-slate-900/80 p-3">
          <p className="mb-2 text-sm text-slate-300">
            {showNewFolder ? 'Create new folder in:' : 'Create new file in:'} <span className="font-mono text-slate-100">{normalizedPath}</span>
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder={showNewFolder ? 'Folder name' : 'File name (e.g. notes.txt)'}
              className="flex-1 rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 border border-slate-700"
              onKeyDown={(e) => {
                if (e.key === 'Enter') showNewFolder ? handleCreateFolder() : handleCreateFile()
                if (e.key === 'Escape') { setShowNewFolder(false); setShowNewFile(false) }
              }}
              autoFocus
            />
            <Button type="button" onClick={showNewFolder ? handleCreateFolder : handleCreateFile} variant="primary" size="sm">
              Create
            </Button>
            <Button type="button" onClick={() => { setShowNewFolder(false); setShowNewFile(false) }} variant="secondary" size="sm">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Current path */}
      <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
        <p className="text-xs uppercase tracking-wide text-slate-500">Current Path</p>
        <p className="mt-1 font-mono text-sm text-slate-200">{normalizedPath}</p>
      </div>

      {/* Breadcrumbs */}
      <div className="mb-4 rounded-lg border border-slate-800 bg-slate-950/40 px-2 py-1.5">
        {renderPathBreadcrumbs(normalizedPath, onNavigate)}
      </div>

      <div className="grid gap-4 lg:grid-cols-[35%_65%]">
        {/* Directory tree */}
        <aside className="rounded-lg border border-slate-800 bg-slate-950/30 p-2">
          <p className="mb-2 px-2 text-xs uppercase tracking-wide text-slate-500">Directory Tree</p>
          <div className="max-h-80 overflow-auto">
            {tree.length === 0 ? (
              <p className="px-2 py-3 text-sm text-slate-500">No directories available.</p>
            ) : (
              <ul className="space-y-1">
                {tree.map((node) => (
                  <TreeNode
                    key={node.path}
                    node={node}
                    level={0}
                    currentPath={normalizedPath}
                    expandedPaths={expandedPaths}
                    onToggle={handleTogglePath}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Files table with drag-and-drop zone */}
        <div
          ref={dropZoneRef}
          className={`rounded-lg border p-2 transition-colors ${
            isDragOver
              ? 'border-brand-500 bg-brand-600/10'
              : 'border-slate-800 bg-slate-950/30'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <p className="mb-2 px-2 text-xs uppercase tracking-wide text-slate-500">
            Files & Folders
            {isDragOver && <span className="ml-2 text-brand-400">Drop files here to upload</span>}
          </p>

          <div className="max-h-80 overflow-auto rounded-md border border-slate-800">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-900/80 text-slate-300 sticky top-0">
                <tr>
                  <th className="w-8 px-2 py-2"></th>
                  <SortHeader field="name" label="Name" />
                  <SortHeader field="type" label="Type" />
                  <SortHeader field="size" label="Size" />
                  <SortHeader field="modified" label="Modified" />
                  <th className="px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-800 text-slate-200">
                {sortedEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      Directory is empty.
                    </td>
                  </tr>
                ) : (
                  sortedEntries.map((entry) => (
                    <tr
                      key={entry.path}
                      className={`transition hover:bg-slate-900/60 ${selectedEntries.has(entry.path) ? 'bg-brand-600/10' : ''}`}
                      onContextMenu={(e) => handleContextMenu(e, entry)}
                    >
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={selectedEntries.has(entry.path)}
                          onChange={() => toggleSelect(entry.path)}
                          className="rounded border-slate-600 bg-slate-800 text-brand-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onDoubleClick={() => {
                            if (entry.type === 'folder') {
                              onNavigate(normalizePath(entry.path))
                            }
                          }}
                          className="flex items-center gap-2 text-left"
                        >
                          {getFileIcon(entry.name, entry.type)}
                          <span className="text-slate-100">{entry.name}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2 capitalize text-slate-400">{entry.type}</td>
                      <td className="px-3 py-2 text-slate-400">{entry.size ?? '-'}</td>
                      <td className="px-3 py-2 text-slate-400">{entry.modifiedAt ?? '-'}</td>
                      <td className="px-3 py-2">
                        {entry.type === 'file' ? (
                          <Button
                            type="button"
                            onClick={() => void handleDownload(entry.path)}
                            isLoading={downloadingFiles.has(entry.path)}
                            variant="secondary"
                            size="sm"
                          >
                            Download
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.entry && (
            <>
              <div className="px-3 py-1.5 text-xs text-slate-500 border-b border-slate-700 truncate max-w-[200px]">
                {contextMenu.entry.name}
              </div>
              {contextMenu.entry.type === 'folder' && (
                <button
                  className="w-full px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
                  onClick={() => { onNavigate(normalizePath(contextMenu.entry!.path)); closeContextMenu() }}
                >
                  Open
                </button>
              )}
              <button
                className="w-full px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.entry!.path).catch(() => {})
                  closeContextMenu()
                }}
              >
                Copy Path
              </button>
              {onProperties && (
                <button
                  className="w-full px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
                  onClick={() => { onProperties(contextMenu.entry!.path); closeContextMenu() }}
                >
                  Properties
                </button>
              )}
              {onPreview && contextMenu.entry.type === 'file' && (
                <button
                  className="w-full px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
                  onClick={() => { onPreview(contextMenu.entry!.path); closeContextMenu() }}
                >
                  Preview
                </button>
              )}
              {onRename && (
                <button
                  className="w-full px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
                  onClick={() => { onRename(contextMenu.entry!.path, contextMenu.entry!.name); closeContextMenu() }}
                >
                  Rename
                </button>
              )}
              {onZip && (
                <button
                  className="w-full px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
                  onClick={() => { onZip(contextMenu.entry!.path); closeContextMenu() }}
                >
                  Zip
                </button>
              )}
              {onDelete && (
                <button
                  className="w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-slate-800 border-t border-slate-700 mt-1 pt-1"
                  onClick={() => { onDelete(contextMenu.entry!.path, contextMenu.entry!.type === 'folder'); closeContextMenu() }}
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
