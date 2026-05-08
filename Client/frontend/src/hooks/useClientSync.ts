import { useEffect } from 'react'
import { useBridgeWebSocket } from './BridgeWebSocketProvider'
import { useDashboardStore, type CachedClient } from '../store/dashboardStore.ts'

const CLIENT_POLL_INTERVAL_MS = 5000

function toClient(value: unknown): CachedClient | null {
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  const id = String(record.id ?? record.clientId ?? '').trim()
  if (!id) return null

  return {
    id,
    hostname: typeof record.hostname === 'string' ? record.hostname : undefined,
    username: typeof record.username === 'string' ? record.username : undefined,
    ip: typeof record.ip === 'string' ? record.ip : undefined,
    ip_address: typeof record.ip_address === 'string' ? record.ip_address : undefined,
    os: typeof record.os === 'string' ? record.os : undefined,
    os_version: typeof record.os_version === 'string' ? record.os_version : undefined,
    status: typeof record.status === 'string' ? record.status : undefined,
    is_online: typeof record.is_online === 'number' ? record.is_online : undefined,
    connected: typeof record.connected === 'boolean' ? record.connected : undefined,
    lastSeen: typeof record.lastSeen === 'number' ? record.lastSeen : undefined,
    last_seen: typeof record.last_seen === 'number' ? record.last_seen : undefined,
    lastSeenFormatted: typeof record.lastSeenFormatted === 'string' ? record.lastSeenFormatted : undefined,
  }
}

function toClientList(payload: unknown): CachedClient[] {
  if (!Array.isArray(payload)) return []
  return payload.map(toClient).filter((client): client is CachedClient => client !== null)
}

export function useClientSync() {
  const { isConnected, send, subscribeAll } = useBridgeWebSocket()
  const { impersonateUserId, setClients, upsertClient, removeClient } = useDashboardStore()

  useEffect(() => {
    const unsubscribe = subscribeAll((message, topic) => {
      const resolvedTopic = topic ?? message.topic ?? message.type

      if (resolvedTopic === 'client_list' || resolvedTopic === 'clients') {
        const nextClients = toClientList(message.clients ?? message.payload ?? message.data)
        setClients(nextClients)
        return
      }

      if (resolvedTopic === 'client_update' || resolvedTopic === 'client_connected') {
        const nextClient = toClient(message.payload ?? message.client ?? message.data ?? message)
        if (nextClient) upsertClient(nextClient)
        return
      }

      if (resolvedTopic === 'client_disconnected' || resolvedTopic === 'client_deleted') {
        const clientId = String(message.clientId ?? message.id ?? '').trim()
        if (clientId) removeClient(clientId)
        return
      }

      if (resolvedTopic === 'db_response' && message.query === 'get_clients') {
        const nextClients = toClientList(message.data)
        setClients(nextClients)
      }
    })

    return unsubscribe
  }, [subscribeAll, setClients, upsertClient, removeClient])

  useEffect(() => {
    if (!isConnected) return

    const sendGetClients = () => {
      send({
        type: 'db_query',
        query: 'get_clients',
        limit: 500,
        offset: 0,
        impersonateUserId: impersonateUserId ?? undefined,
      })
    }

    sendGetClients()
    const timer = setInterval(sendGetClients, CLIENT_POLL_INTERVAL_MS)

    return () => {
      clearInterval(timer)
    }
  }, [isConnected, send, impersonateUserId])
}
