import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import useWebSocket from './useWebSocket'
import { getWebSocketUrl } from '../utils/websocket'

type BridgeMessage = {
  type?: string
  [key: string]: unknown
}

type BridgeSocketContextValue = ReturnType<typeof useWebSocket<BridgeMessage, unknown>>

const BridgeWebSocketContext = createContext<BridgeSocketContextValue | null>(null)

interface BridgeWebSocketProviderProps {
  children: ReactNode
  enabled?: boolean
}

export function BridgeWebSocketProvider({ children, enabled = false }: BridgeWebSocketProviderProps) {
  const socket = useWebSocket<BridgeMessage, unknown>(getWebSocketUrl(), {
    autoConnect: enabled,
    reconnect: true,
    reconnectIntervalMs: 5000,
    maxReconnectAttempts: 10,
    getTopic: (message) => message?.type,
  })

  return <BridgeWebSocketContext.Provider value={socket}>{children}</BridgeWebSocketContext.Provider>
}

export function useBridgeWebSocket() {
  const context = useContext(BridgeWebSocketContext)
  if (!context) {
    throw new Error('useBridgeWebSocket must be used within BridgeWebSocketProvider')
  }

  return context
}
