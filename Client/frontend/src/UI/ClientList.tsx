import { useMemo, useState } from 'react'
import { Heading, Input, Table, TableBody, TableCell, TableContainer, TableHead, TableHeaderCell } from './index'

export type ClientStatus = 'online' | 'offline' | (string & {})

export interface ClientItem {
  id: string
  ip: string
  hostname: string
  username?: string
  os: string
  status: ClientStatus
  lastSeen: number
  lastSeenFormatted?: string
  connected?: boolean
}

type SortKey = keyof Pick<ClientItem, 'id' | 'ip' | 'hostname' | 'os' | 'status' | 'lastSeen'>
type SortDirection = 'asc' | 'desc'

export interface ClientListProps {
  clients: ClientItem[]
  onSelectClient: (client: ClientItem) => void
  selectedClientId?: string
  onDeleteClient?: (client: ClientItem) => void
  onKillClient?: (client: ClientItem) => void
  className?: string
}

const columns: Array<{ key: SortKey; label: string }> = [
  { key: 'id', label: 'ID' },
  { key: 'ip', label: 'IP' },
  { key: 'hostname', label: 'Hostname' },
  { key: 'os', label: 'OS' },
  { key: 'status', label: 'Status' },
  { key: 'lastSeen', label: 'Last Seen' },
]

function compareValues(a: string, b: string, direction: SortDirection): number {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  if (left === right) return 0
  const base = left > right ? 1 : -1
  return direction === 'asc' ? base : -base
}

export default function ClientList({
  clients,
  onSelectClient,
  selectedClientId,
  onDeleteClient,
  onKillClient,
  className,
}: ClientListProps) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('lastSeen')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const filteredAndSortedClients = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    const filtered = normalizedQuery
      ? clients.filter((client) => {
          const lastSeenStr = client.lastSeenFormatted || new Date(client.lastSeen).toLocaleString();
          return (
            client.id.toLowerCase().includes(normalizedQuery) ||
            client.ip.toLowerCase().includes(normalizedQuery) ||
            client.hostname.toLowerCase().includes(normalizedQuery) ||
            client.os.toLowerCase().includes(normalizedQuery) ||
            client.status.toLowerCase().includes(normalizedQuery) ||
            lastSeenStr.toLowerCase().includes(normalizedQuery)
          )
        })
      : clients

    return [...filtered].sort((a, b) => {
      if (sortKey === 'lastSeen') {
        // Sort by timestamp for lastSeen
        const aVal = a.lastSeen;
        const bVal = b.lastSeen;
        const base = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        return sortDirection === 'asc' ? base : -base;
      } else {
        // Sort by string for other fields
        return compareValues(String(a[sortKey]), String(b[sortKey]), sortDirection);
      }
    });
  }, [clients, query, sortDirection, sortKey])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortKey(key)
    setSortDirection('asc')
  }

  return (
    <section className={`panel min-w-0 overflow-hidden p-4 ${className ?? ''}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Heading>Clients</Heading>
        <Input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by ID, IP, hostname, OS..."
          className="max-w-xs"
        />
      </div>

      <TableContainer className="scrollbar-hidden max-h-112 overflow-auto">
        <Table>
          <TableHead>
            <tr>
              {columns.map((column) => {
                const isSorted = sortKey === column.key
                const sortMarker = isSorted ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''

                return (
                  <TableHeaderCell key={column.key} className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur">
                    <button
                      type="button"
                      onClick={() => handleSort(column.key)}
                      className="inline-flex items-center text-slate-300 transition hover:text-slate-100"
                    >
                      {column.label}
                      <span className="ml-1 text-xs text-slate-500">{sortMarker}</span>
                    </button>
                  </TableHeaderCell>
                )
              })}
              {onDeleteClient ? <TableHeaderCell className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur">Actions</TableHeaderCell> : null}
            </tr>
          </TableHead>

          <TableBody>
            {filteredAndSortedClients.length === 0 ? (
              <tr>
                <TableCell colSpan={onDeleteClient ? 7 : 6} className="py-8 text-center text-sm text-slate-400">
                  No clients match your search.
                </TableCell>
              </tr>
            ) : (
              filteredAndSortedClients.map((client) => {
                const online = client.status.toLowerCase() === 'online'
                const isSelected = selectedClientId === client.id

                return (
                  <tr
                    key={client.id}
                    onClick={() => onSelectClient(client)}
                    className={`cursor-pointer transition ${
                      isSelected ? 'bg-brand-600/25 ring-1 ring-inset ring-brand-500/50' : 'hover:bg-slate-900/70'
                    }`}
                  >
                    <TableCell className="font-medium text-slate-100">{client.id}</TableCell>
                    <TableCell>{client.ip}</TableCell>
                    <TableCell>{client.hostname}</TableCell>
                    <TableCell>{client.os}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={`inline-block size-2 rounded-full ${
                            online ? 'bg-emerald-500' : 'bg-red-500'
                          }`}
                        />
                        <span className={online ? 'text-emerald-400' : 'text-red-400'}>{client.status}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-slate-400">
                      {client.lastSeenFormatted || new Date(client.lastSeen).toLocaleString()}
                    </TableCell>
                    {onDeleteClient || onKillClient ? (
                      <TableCell>
                        <div className="flex gap-1">
                          {onKillClient ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                onKillClient(client)
                              }}
                              className="rounded-md border border-orange-700/50 bg-orange-900/20 px-2 py-1 text-xs font-medium text-orange-300 transition hover:bg-orange-900/40"
                            >
                              Kill
                            </button>
                          ) : null}
                          {onDeleteClient ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                onDeleteClient(client)
                              }}
                              className="rounded-md border border-red-700/50 bg-red-900/20 px-2 py-1 text-xs font-medium text-red-300 transition hover:bg-red-900/40"
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </TableCell>
                    ) : null}
                  </tr>
                )
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </section>
  )
}
