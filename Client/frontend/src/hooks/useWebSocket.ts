import { useCallback, useEffect, useRef, useState } from 'react'

export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'connecting'

export type TopicHandler<TIncoming> = (payload: TIncoming, rawEvent: MessageEvent) => void
export type AnyMessageHandler<TIncoming> = (payload: TIncoming, topic: string | undefined, rawEvent: MessageEvent) => void

export interface WebSocketMessageEnvelope<TPayload = unknown> {
  topic?: string
  payload: TPayload
}

export interface UseWebSocketOptions<TIncoming = unknown, TOutgoing = unknown> {
  autoConnect?: boolean
  reconnect?: boolean
  reconnectIntervalMs?: number
  maxReconnectAttempts?: number
  protocols?: string | string[]
  serialize?: (message: TOutgoing | WebSocketMessageEnvelope<TOutgoing>) => string
  deserialize?: (rawData: string) => TIncoming
  getTopic?: (message: TIncoming) => string | undefined
  onOpen?: (event: Event) => void
  onClose?: (event: CloseEvent) => void
  onError?: (event: Event) => void
}

export interface UseWebSocketReturn<TIncoming = unknown, TOutgoing = unknown> {
  status: ConnectionStatus
  isConnected: boolean
  lastError: string | null
  connect: () => void
  disconnect: () => void
  send: (message: TOutgoing | WebSocketMessageEnvelope<TOutgoing>) => boolean
  sendToTopic: (topic: string, message: TOutgoing) => boolean
  sendRaw: (rawData: string) => boolean
  subscribe: (topic: string, handler: TopicHandler<TIncoming>) => () => void
  subscribeAll: (handler: AnyMessageHandler<TIncoming>) => () => void
}

const defaultDeserialize = <TIncoming,>(rawData: string): TIncoming => {
  return JSON.parse(rawData) as TIncoming
}

const defaultSerialize = <TOutgoing,>(message: TOutgoing | WebSocketMessageEnvelope<TOutgoing>): string => {
  return typeof message === 'string' ? message : JSON.stringify(message)
}

const HEARTBEAT_INTERVAL_MS = 30000 // 30 second heartbeats
const MAX_RECONNECT_DELAY_MS = 30000 // Max 30 second reconnect delay

export function useWebSocket<TIncoming = unknown, TOutgoing = unknown>(
  url: string,
  options?: UseWebSocketOptions<TIncoming, TOutgoing>,
): UseWebSocketReturn<TIncoming, TOutgoing> {
  const {
    autoConnect = true,
    reconnect = true,
    reconnectIntervalMs = 3000,
    maxReconnectAttempts = Infinity,
    protocols,
    serialize = defaultSerialize<TOutgoing>,
    deserialize = defaultDeserialize<TIncoming>,
    getTopic,
    onOpen,
    onClose,
    onError,
  } = options ?? {}

  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [lastError, setLastError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const shouldReconnectRef = useRef(reconnect)
  const manualCloseRef = useRef(false)
  const reconnectOnCloseRef = useRef(false)

  const serializeRef = useRef(serialize)
  const deserializeRef = useRef(deserialize)
  const getTopicRef = useRef(getTopic)
  const onOpenRef = useRef(onOpen)
  const onCloseRef = useRef(onClose)
  const onErrorRef = useRef(onError)
  const connectRef = useRef<() => void>(() => {})

  const subscribersRef = useRef<Map<string, Set<TopicHandler<TIncoming>>>>(new Map())
  const anySubscribersRef = useRef<Set<AnyMessageHandler<TIncoming>>>(new Set())

  useEffect(() => {
    shouldReconnectRef.current = reconnect
  }, [reconnect])

  useEffect(() => {
    serializeRef.current = serialize
    deserializeRef.current = deserialize
    getTopicRef.current = getTopic
    onOpenRef.current = onOpen
    onCloseRef.current = onClose
    onErrorRef.current = onError
  }, [serialize, deserialize, getTopic, onOpen, onClose, onError])

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
  }, [])

  const startHeartbeat = useCallback(() => {
    stopHeartbeat()

    heartbeatTimerRef.current = setInterval(() => {
      const socket = wsRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return
      }

      socket.send(
        JSON.stringify({
          topic: 'ping',
          payload: { timestamp: Date.now() },
        }),
      )
    }, HEARTBEAT_INTERVAL_MS)
  }, [stopHeartbeat])

  const cleanupSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      wsRef.current.onmessage = null
      wsRef.current = null
    }
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current || manualCloseRef.current || !reconnectOnCloseRef.current) {
      return
    }

    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      console.log('Max reconnect attempts reached, stopping reconnection');
      return
    }

    const currentAttempt = reconnectAttemptsRef.current
    const delay = Math.min(reconnectIntervalMs * 2 ** currentAttempt, MAX_RECONNECT_DELAY_MS)
    reconnectAttemptsRef.current = currentAttempt + 1

    console.log(`Scheduling reconnect attempt ${currentAttempt + 1} in ${delay}ms`);
    clearReconnectTimer()

    reconnectTimerRef.current = setTimeout(() => {
      connectRef.current()
    }, delay)
  }, [clearReconnectTimer, maxReconnectAttempts, reconnectIntervalMs])

  const connect = useCallback(() => {
    if (!url) {
      setStatus('error')
      setLastError('WebSocket URL is required.')
      return
    }

    const currentSocket = wsRef.current
    if (currentSocket && (currentSocket.readyState === WebSocket.OPEN || currentSocket.readyState === WebSocket.CONNECTING)) {
      return
    }

    manualCloseRef.current = false
    clearReconnectTimer()
    reconnectOnCloseRef.current = false
    setStatus('connecting')

    try {
      const socket = new WebSocket(url, protocols)
      wsRef.current = socket

      socket.onopen = (event: Event) => {
        reconnectAttemptsRef.current = 0
        reconnectOnCloseRef.current = false
        setStatus('connected')
        setLastError(null)
        startHeartbeat()
        onOpenRef.current?.(event)
      }

      socket.onmessage = (event: MessageEvent) => {
        let parsed: TIncoming

        try {
          parsed = deserializeRef.current(String(event.data))
        } catch {
          return
        }

        const topic = getTopicRef.current ? getTopicRef.current(parsed) : (parsed as { topic?: string })?.topic

        if (topic) {
          const topicHandlers = subscribersRef.current.get(topic)
          topicHandlers?.forEach((handler) => handler(parsed, event))
        }

        anySubscribersRef.current.forEach((handler) => handler(parsed, topic, event))
      }

      socket.onerror = (event: Event) => {
        reconnectOnCloseRef.current = true
        setStatus('error')
        setLastError('WebSocket connection error.')
        onErrorRef.current?.(event)
      }

      socket.onclose = (event: CloseEvent) => {
        stopHeartbeat()
        cleanupSocket()
        setStatus('disconnected')
        onCloseRef.current?.(event)
        
        // Handle specific WebSocket error codes
        const code = event.code;
        console.log(`WebSocket closed with code: ${code}, reason: ${event.reason}`);
        
        // Don't reconnect for these codes:
        // 1005: No status code (normal closure)
        // 1001: Going away (page navigation, tab closed)
        // 1000: Normal closure
        if (code === 1005 || code === 1001 || code === 1000) {
          console.log('Normal closure, not reconnecting');
          manualCloseRef.current = true;
          reconnectOnCloseRef.current = false;
          return;
        }
        
        // Code 1006: Abnormal closure (network issue) - attempt reconnect
        if (code === 1006) {
          console.log('Abnormal closure (network issue), attempting reconnect');
          reconnectOnCloseRef.current = true;
          scheduleReconnect();
          return;
        }
        
        // For other codes, use default reconnect logic
        reconnectOnCloseRef.current = true;
        scheduleReconnect();
      }
    } catch (error) {
      reconnectOnCloseRef.current = true
      setStatus('error')
      setLastError(error instanceof Error ? error.message : 'Failed to create WebSocket connection.')
      scheduleReconnect()
    }
  }, [url, protocols, clearReconnectTimer, scheduleReconnect, cleanupSocket, startHeartbeat, stopHeartbeat])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const disconnect = useCallback(() => {
    manualCloseRef.current = true
    reconnectOnCloseRef.current = false
    clearReconnectTimer()
    stopHeartbeat()
    reconnectAttemptsRef.current = 0

    if (wsRef.current) {
      wsRef.current.close()
      cleanupSocket()
    }

    setStatus('disconnected')
  }, [clearReconnectTimer, cleanupSocket, stopHeartbeat])

  const sendRaw = useCallback((rawData: string): boolean => {
    const socket = wsRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false
    }

    socket.send(rawData)
    return true
  }, [])

  const send = useCallback(
    (message: TOutgoing | WebSocketMessageEnvelope<TOutgoing>): boolean => {
      const socket = wsRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false
      }

      try {
        const payload = serializeRef.current(message)
        socket.send(payload)
        return true
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'Failed to serialize WebSocket message.')
        setStatus('error')
        return false
      }
    },
    [],
  )

  const sendToTopic = useCallback(
    (topic: string, message: TOutgoing): boolean => {
      return send({ topic, payload: message })
    },
    [send],
  )

  const subscribe = useCallback((topic: string, handler: TopicHandler<TIncoming>): (() => void) => {
    const existing = subscribersRef.current.get(topic)
    if (existing) {
      existing.add(handler)
    } else {
      subscribersRef.current.set(topic, new Set([handler]))
    }

    return () => {
      const topicHandlers = subscribersRef.current.get(topic)
      if (!topicHandlers) {
        return
      }

      topicHandlers.delete(handler)
      if (topicHandlers.size === 0) {
        subscribersRef.current.delete(topic)
      }
    }
  }, [])

  const subscribeAll = useCallback((handler: AnyMessageHandler<TIncoming>): (() => void) => {
    anySubscribersRef.current.add(handler)

    return () => {
      anySubscribersRef.current.delete(handler)
    }
  }, [])

  useEffect(() => {
    if (!autoConnect) {
      return
    }

    connect()

    return () => {
      disconnect()
    }
  }, [autoConnect, connect, disconnect])

  useEffect(() => {
    return () => {
      clearReconnectTimer()
      stopHeartbeat()
      cleanupSocket()
    }
  }, [clearReconnectTimer, cleanupSocket, stopHeartbeat])

  return {
    status,
    isConnected: status === 'connected',
    lastError,
    connect,
    disconnect,
    send,
    sendToTopic,
    sendRaw,
    subscribe,
    subscribeAll,
  }
}

export default useWebSocket
