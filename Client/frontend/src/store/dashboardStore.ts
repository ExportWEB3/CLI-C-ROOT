import { createContext, createElement, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';

export interface ProcessInfo {
  pid: number;
  name: string;
  memory: number;
  architecture: string;
  username: string;
  path: string;
  priority: number;
}

interface ProcessListCache {
  processes: ProcessInfo[];
  timestamp: number;
}

export interface CachedClient {
  id: string;
  hostname?: string;
  username?: string;
  ip?: string;
  ip_address?: string;
  os?: string;
  os_version?: string;
  status?: string;
  is_online?: number;
  connected?: boolean;
  lastSeen?: number;
  last_seen?: number;
  lastSeenFormatted?: string;
}

interface DashboardStoreState {
  commandOutput: Map<string, string>;
  processLists: Map<string, ProcessListCache>;
  clients: CachedClient[];
  addCommandOutput: (clientId: string, output: string) => void;
  getCommandOutput: (clientId: string) => string;
  setProcessList: (clientId: string, processes: ProcessInfo[]) => void;
  getProcessList: (clientId: string) => ProcessInfo[] | null;
  shouldRefreshProcessList: (clientId: string) => boolean;
  setClients: (clients: CachedClient[]) => void;
  upsertClient: (client: CachedClient) => void;
  removeClient: (clientId: string) => void;
  clearClientData: (clientId: string) => void;
  clearAllData: () => void;
  impersonateUserId: string | null;
  impersonateUsername: string | null;
  setImpersonation: (userId: string, username: string) => void;
  clearImpersonation: () => void;
}

const DashboardStoreContext = createContext<DashboardStoreState | undefined>(undefined);

const CACHE_TTL_MS = 30 * 1000;
const COMMAND_OUTPUT_STORAGE_KEY = 'dashboardStore.commandOutput.v1';
const PROCESS_LIST_STORAGE_KEY = 'dashboardStore.processLists.v1';
const IMPERSONATION_STORAGE_KEY = 'dashboardStore.impersonation.v1';

function loadCommandOutputMap(): Map<string, string> {
  if (typeof window === 'undefined') return new Map();

  try {
    const raw = window.localStorage.getItem(COMMAND_OUTPUT_STORAGE_KEY);
    if (!raw) return new Map();

    const parsed = JSON.parse(raw) as Array<[string, string]>;
    if (!Array.isArray(parsed)) return new Map();

    return new Map(
      parsed.filter((entry): entry is [string, string] => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string')
    );
  } catch {
    return new Map();
  }
}

function loadProcessListMap(): Map<string, ProcessListCache> {
  if (typeof window === 'undefined') return new Map();

  try {
    const raw = window.localStorage.getItem(PROCESS_LIST_STORAGE_KEY);
    if (!raw) return new Map();

    const parsed = JSON.parse(raw) as Array<[string, ProcessListCache]>;
    if (!Array.isArray(parsed)) return new Map();

    const restored = parsed.filter(
      (entry): entry is [string, ProcessListCache] =>
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'object' &&
        entry[1] !== null &&
        Array.isArray(entry[1].processes) &&
        typeof entry[1].timestamp === 'number'
    );

    return new Map(restored);
  } catch {
    return new Map();
  }
}

export function DashboardStoreProvider({ children }: { children: ReactNode }) {
  const [commandOutputMap, setCommandOutputMap] = useState<Map<string, string>>(() => loadCommandOutputMap());
  const [processListMap, setProcessListMap] = useState<Map<string, ProcessListCache>>(() => loadProcessListMap());
  const [clients, setClientsState] = useState<CachedClient[]>([]);
  const [impersonation, setImpersonationState] = useState<{ userId: string; username: string } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COMMAND_OUTPUT_STORAGE_KEY, JSON.stringify(Array.from(commandOutputMap.entries())));
  }, [commandOutputMap]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PROCESS_LIST_STORAGE_KEY, JSON.stringify(Array.from(processListMap.entries())));
  }, [processListMap]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Clear legacy persisted impersonation from older builds
    window.localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
  }, []);

  const addCommandOutput = useCallback((clientId: string, output: string) => {
    setCommandOutputMap(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(clientId) || '';
      newMap.set(clientId, existing ? `${existing}\n${output}` : output);
      return newMap;
    });
  }, []);

  const getCommandOutput = useCallback((clientId: string): string => {
    return commandOutputMap.get(clientId) || '';
  }, [commandOutputMap]);

  const setProcessList = useCallback((clientId: string, processes: ProcessInfo[]) => {
    setProcessListMap(prev => {
      const newMap = new Map(prev);
      newMap.set(clientId, {
        processes,
        timestamp: Date.now()
      });
      return newMap;
    });
  }, []);

  const getProcessList = useCallback((clientId: string): ProcessInfo[] | null => {
    const cache = processListMap.get(clientId);
    if (!cache) return null;

    if (Date.now() - cache.timestamp > CACHE_TTL_MS) {
      setProcessListMap(prev => {
        if (!prev.has(clientId)) return prev;
        const newMap = new Map(prev);
        newMap.delete(clientId);
        return newMap;
      });
      return null;
    }

    return cache.processes;
  }, [processListMap]);

  const shouldRefreshProcessList = useCallback((clientId: string): boolean => {
    const cache = processListMap.get(clientId);
    if (!cache) return true;
    return Date.now() - cache.timestamp > CACHE_TTL_MS;
  }, [processListMap]);

  const setClients = useCallback((nextClients: CachedClient[]) => {
    setClientsState(() => {
      const deduped = new Map<string, CachedClient>();
      nextClients.forEach((client) => {
        if (!client?.id) return;
        deduped.set(String(client.id), { ...client, id: String(client.id) });
      });
      return Array.from(deduped.values());
    });
  }, []);

  const upsertClient = useCallback((client: CachedClient) => {
    if (!client?.id) return;
    const clientId = String(client.id);
    setClientsState((previous) => {
      const index = previous.findIndex((item) => item.id === clientId);
      if (index === -1) {
        return [{ ...client, id: clientId }, ...previous];
      }

      const next = [...previous];
      next[index] = { ...next[index], ...client, id: clientId };
      return next;
    });
  }, []);

  const removeClient = useCallback((clientId: string) => {
    setClientsState((previous) => previous.filter((client) => client.id !== clientId));
  }, []);

  const clearClientData = useCallback((clientId: string) => {
    setCommandOutputMap(prev => {
      const newMap = new Map(prev);
      newMap.delete(clientId);
      return newMap;
    });

    setProcessListMap(prev => {
      const newMap = new Map(prev);
      newMap.delete(clientId);
      return newMap;
    });
  }, []);

  const clearAllData = useCallback(() => {
    setCommandOutputMap(new Map());
    setProcessListMap(new Map());
    setClientsState([]);
  }, []);

  const setImpersonation = useCallback((userId: string, username: string) => {
    setImpersonationState({ userId, username });
  }, []);

  const clearImpersonation = useCallback(() => {
    setImpersonationState(null);
  }, []);

  const storeState: DashboardStoreState = {
    commandOutput: commandOutputMap,
    processLists: processListMap,
    clients,
    addCommandOutput,
    getCommandOutput,
    setProcessList,
    getProcessList,
    shouldRefreshProcessList,
    setClients,
    upsertClient,
    removeClient,
    clearClientData,
    clearAllData,
    impersonateUserId: impersonation?.userId ?? null,
    impersonateUsername: impersonation?.username ?? null,
    setImpersonation,
    clearImpersonation,
  };

  return createElement(
    DashboardStoreContext.Provider,
    { value: storeState },
    children
  );
}

export function useDashboardStore() {
  const context = useContext(DashboardStoreContext);
  if (context === undefined) {
    throw new Error('useDashboardStore must be used within a DashboardStoreProvider');
  }
  return context;
}
