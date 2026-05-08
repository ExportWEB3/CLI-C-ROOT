import { useEffect, useState } from 'react'
import { useBridgeWebSocket } from '../../hooks/BridgeWebSocketProvider'
import { useDashboardStore } from '../../store/dashboardStore.ts'

interface ClientData {
  id: string
  hostname: string
  username: string
  lastSeen: number
  lastSeenFormatted: string
  connected: boolean
  status: 'online' | 'offline'
  ip?: string
  os?: string
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (seconds < 60) return `${seconds}s ago`
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return new Date(timestamp).toLocaleDateString()
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientData[]>([])
  const { status, lastError, subscribeAll } = useBridgeWebSocket()
  const { clients: cachedClients } = useDashboardStore()

  useEffect(() => {
    const initial = cachedClients.map((client) => {
      const lastSeen = Number(client.lastSeen ?? client.last_seen ?? Date.now())
      const isOnline = client.is_online === 1 || client.connected === true || client.status === 'online'

      return {
        id: client.id,
        hostname: client.hostname || 'Unknown',
        username: client.username || 'Unknown',
        lastSeen,
        lastSeenFormatted: formatTimeAgo(lastSeen),
        connected: isOnline,
        status: isOnline ? ('online' as const) : ('offline' as const),
        ip: client.ip || client.ip_address || 'Unknown',
        os: client.os || client.os_version || 'Windows'
      }
    })

    if (initial.length > 0) {
      setClients(initial)
    }
  }, [cachedClients])

  useEffect(() => {
    const unsubscribe = subscribeAll((message, topic) => {
      const resolvedTopic = topic ?? message.topic ?? message.type

      if (resolvedTopic === 'client_list' || resolvedTopic === 'clients') {
        const rawClients = message.clients || (message.payload as ClientData[]) || []
        if (Array.isArray(rawClients)) {
          const formattedClients = rawClients.map(client => ({
            ...client,
            lastSeenFormatted: client.lastSeenFormatted || formatTimeAgo(client.lastSeen),
            ip: client.ip || 'Unknown',
            os: client.os || 'Windows'
          }))
          setClients(formattedClients)
        }
        return
      }

      if (resolvedTopic === 'client_update' || resolvedTopic === 'client_connected') {
        const updatedClient = (message.payload as ClientData) || (message as unknown as ClientData)
        if (updatedClient && updatedClient.id) {
          setClients(prev => {
            const index = prev.findIndex(c => c.id === updatedClient.id)
            if (index === -1) {
              return [...prev, {
                ...updatedClient,
                lastSeenFormatted: updatedClient.lastSeenFormatted || formatTimeAgo(updatedClient.lastSeen),
                ip: updatedClient.ip || 'Unknown',
                os: updatedClient.os || 'Windows'
              }]
            }
            const newClients = [...prev]
            newClients[index] = {
              ...newClients[index],
              ...updatedClient,
              lastSeenFormatted: updatedClient.lastSeenFormatted || formatTimeAgo(updatedClient.lastSeen)
            }
            return newClients
          })
        }
        return
      }
    })

    return unsubscribe
  }, [subscribeAll])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-2xl font-semibold text-slate-100">Clients</h3>
        <p className="text-sm text-slate-400">
          Detailed endpoint view for active and inactive clients. 
          WebSocket: <span className={`font-medium ${status === 'connected' ? 'text-emerald-400' : 'text-red-400'}`}>{status}</span>
          {lastError && <span className="ml-2 text-red-400">Error: {lastError}</span>}
        </p>
      </div>

      <section className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-900/80 text-slate-300">
              <tr>
                <th className="px-4 py-3 font-medium">Client ID</th>
                <th className="px-4 py-3 font-medium">Hostname</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">OS</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last Seen</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800 text-slate-200">
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    {status === 'connected' ? 'No clients connected' : 'Connecting to server...'}
                  </td>
                </tr>
              ) : (
                clients.map((client) => {
                  const online = client.status === 'online'
                  return (
                    <tr key={client.id} className="hover:bg-slate-900/60">
                      <td className="px-4 py-3 text-slate-100 font-medium">{client.id}</td>
                      <td className="px-4 py-3">{client.hostname}</td>
                      <td className="px-4 py-3">{client.username}</td>
                      <td className="px-4 py-3">{client.os}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-2 ${online ? 'text-emerald-400' : 'text-red-400'}`}>
                          <span className={`inline-block size-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          {client.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{client.lastSeenFormatted}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
