/**
 * ClientFilter — global reusable client selector used across all pages.
 * Shows a green pulsing dot for online clients, red for offline.
 * Accepts the raw `clients` array from the bridge db_response.
 */

import { useRef, useState, useEffect } from 'react'

export interface ClientInfo {
  id: string
  hostname: string
  username?: string
  ip_address?: string
  is_online?: number   // 1 = online, 0 = offline (from DB)
  keylog_active?: number
  last_seen?: number
}

interface Props {
  clients: ClientInfo[]
  value: string
  onChange: (id: string) => void
  /** Show an "All clients" option at the top */
  allowAll?: boolean
  /** Label for the all-clients option */
  allLabel?: string
  placeholder?: string
  className?: string
  /** Extra status badge per client id → label text */
  badges?: Record<string, { label: string; color: string }>
  disabled?: boolean
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span className="relative flex-none flex items-center justify-center w-4 h-4">
      {online ? (
        <>
          <span className="absolute inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping opacity-60" />
          <span className="relative inline-block w-2 h-2 rounded-full bg-emerald-400" />
        </>
      ) : (
        <>
          <span className="absolute inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-ping opacity-40" />
          <span className="relative inline-block w-2 h-2 rounded-full bg-red-500" />
        </>
      )}
    </span>
  )
}

export default function ClientFilter({
  clients,
  value,
  onChange,
  allowAll = false,
  allLabel = 'All clients',
  placeholder = 'Select target...',
  className = '',
  badges = {},
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const selected = clients.find(c => c.id === value)

  const sorted = [...clients].sort((a, b) => {
    // Online first, then alphabetical hostname
    const ao = a.is_online ?? 0
    const bo = b.is_online ?? 0
    if (ao !== bo) return bo - ao
    return (a.hostname || '').localeCompare(b.hostname || '')
  })

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={`
          flex items-center gap-2 min-w-55 max-w-xs px-3 py-1.5
          bg-slate-900 border rounded-md text-sm text-left
          transition-all select-none
          ${disabled ? 'opacity-50 cursor-not-allowed border-slate-700' : 'border-slate-700 hover:border-slate-500 cursor-pointer'}
          ${open ? 'border-slate-500 ring-1 ring-slate-600' : ''}
        `}
      >
        {value === 'all' && allowAll ? (
          <>
            <span className="flex-none w-4 h-4 flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-sky-400" />
            </span>
            <span className="flex-1 text-sky-300 font-medium truncate">{allLabel}</span>
          </>
        ) : selected ? (
          <>
            <StatusDot online={!!(selected.is_online)} />
            <span className="flex-1 text-slate-200 truncate">{selected.hostname}</span>
            <span className="flex-none text-slate-600 font-mono text-[10px]">{selected.id.slice(0, 8)}</span>
          </>
        ) : (
          <>
            <span className="flex-none w-4 h-4" />
            <span className="flex-1 text-slate-500">{placeholder}</span>
          </>
        )}
        <span className={`flex-none ml-1 text-slate-500 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="
          absolute z-50 top-full mt-1 left-0 min-w-65 max-h-72 overflow-y-auto
          bg-slate-900 border border-slate-700 rounded-lg shadow-2xl shadow-black/60
          py-1
        ">
          {allowAll && (
            <button
              type="button"
              onClick={() => { onChange('all'); setOpen(false) }}
              className={`
                w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors
                ${value === 'all' ? 'bg-slate-800 text-sky-300' : 'text-sky-400 hover:bg-slate-800'}
              `}
            >
              <span className="flex-none w-4 h-4 flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-sky-400" />
              </span>
              <span className="flex-1 font-medium">{allLabel}</span>
              <span className="text-[10px] text-slate-500">({clients.filter(c => c.is_online).length} online)</span>
            </button>
          )}

          {allowAll && sorted.length > 0 && (
            <div className="my-1 border-t border-slate-800" />
          )}

          {sorted.length === 0 && (
            <div className="px-3 py-4 text-sm text-slate-600 text-center">No clients in database</div>
          )}

          {sorted.map(c => {
            const online = !!(c.is_online)
            const badge = badges[c.id]
            const isSelected = c.id === value
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.id); setOpen(false) }}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors
                  ${isSelected ? 'bg-slate-800' : 'hover:bg-slate-800/60'}
                `}
              >
                <StatusDot online={online} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-medium truncate ${online ? 'text-slate-200' : 'text-slate-400'}`}>
                      {c.hostname}
                    </span>
                    {badge && (
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${badge.color}`}>
                        {badge.label}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5 mt-0.5">
                    <span className="font-mono text-[10px] text-slate-600">{c.id.slice(0, 16)}</span>
                    {c.ip_address && (
                      <span className="text-[10px] text-slate-700">{c.ip_address}</span>
                    )}
                  </div>
                </div>
                <span className={`flex-none text-[10px] font-semibold ${online ? 'text-emerald-500' : 'text-red-600'}`}>
                  {online ? 'LIVE' : 'OFFLINE'}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
