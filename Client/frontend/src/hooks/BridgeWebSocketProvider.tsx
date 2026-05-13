import { createContext, useContext, useRef, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import useWebSocket from './useWebSocket'
import type { TopicHandler } from './useWebSocket'
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

  // Cache last message per topic so late subscribers get it immediately
  const lastMessageRef = useRef<Map<string, BridgeMessage>>(new Map())

  useEffect(() => {
    return socket.subscribeAll((msg, topic) => {
      if (topic) lastMessageRef.current.set(topic, msg as BridgeMessage)
    })
  }, [socket.subscribeAll])

  // Wrap subscribe to replay cached value immediately on registration
  const subscribe = useCallback((topic: string, handler: TopicHandler<BridgeMessage>) => {
    const cached = lastMessageRef.current.get(topic)
    if (cached !== undefined) {
      // Replay on next tick so the caller's useEffect has fully run
      setTimeout(() => handler(cached, null as unknown as MessageEvent), 0)
    }
    return socket.subscribe(topic, handler)
  }, [socket.subscribe])

  const value = { ...socket, subscribe }

  return <BridgeWebSocketContext.Provider value={value}>{children}</BridgeWebSocketContext.Provider>
}

export function useBridgeWebSocket() {
  const context = useContext(BridgeWebSocketContext)
  if (!context) {
    throw new Error('useBridgeWebSocket must be used within BridgeWebSocketProvider')
  }

  return context
}
