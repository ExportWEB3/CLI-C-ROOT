// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get WebSocket URL — cookie is sent automatically (same origin via Vite proxy)
 */
export function getWebSocketUrl(): string {
  // In production swap this with your nginx ws path
  const wsBase = import.meta.env.VITE_WS_URL ?? `ws://${window.location.host}/ws-bridge`;
  return wsBase;
}

/**
 * Get API URL for authentication endpoints
 */
export function getAuthApiUrl(): string {
  return import.meta.env.VITE_AUTH_API_URL ?? 'http://localhost:8081';
}

/**
 * Check if user is authenticated (cookie presence is opaque; check stored user)
 */
export function isAuthenticated(): boolean {
  return !!localStorage.getItem('user');
}

/**
 * Get current user from localStorage
 */
export function getCurrentUser(): { id: string; username: string; role: 'admin' | 'user' } | null {
  const userStr = localStorage.getItem('user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

/**
 * getAuthToken is kept for any legacy callers but always returns null
 * — the real token lives in an HttpOnly cookie that JS cannot read.
 */
export function getAuthToken(): null {
  return null;
}

/**
 * Clear authentication data — call /api/auth/logout to clear the HttpOnly cookie
 */
export async function clearAuth(): Promise<void> {
  localStorage.removeItem('user');
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch { /* ignore network errors on logout */ }
}

/**
 * Save user info in localStorage after login (token lives in HttpOnly cookie set by server)
 */
export function setAuth(_token: string, user: { id: string; username: string; role: 'admin' | 'user' }): void {
  localStorage.setItem('user', JSON.stringify(user));
}