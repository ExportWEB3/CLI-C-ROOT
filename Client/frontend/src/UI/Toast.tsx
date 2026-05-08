import { useState, useCallback, createContext, useContext, createElement, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms, 0 = persistent
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => string;
  removeToast: (id: string) => void;
  success: (title: string, message?: string, duration?: number) => string;
  error: (title: string, message?: string, duration?: number) => string;
  info: (title: string, message?: string, duration?: number) => string;
  warning: (title: string, message?: string, duration?: number) => string;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let toastCounter = 0;
function generateId(): string {
  toastCounter += 1;
  return `toast-${toastCounter}-${Date.now()}`;
}

// ─── Provider ────────────────────────────────────────────────────────────────

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
};

const COLORS: Record<ToastType, { bg: string; border: string; icon: string; text: string }> = {
  success: { bg: '#0d2b1a', border: '#27ae60', icon: '#27ae60', text: '#d4edda' },
  error:   { bg: '#2d0f0f', border: '#e74c3c', icon: '#e74c3c', text: '#f5c6cb' },
  info:    { bg: '#0a1f33', border: '#3498db', icon: '#3498db', text: '#cce5ff' },
  warning: { bg: '#2d1f0a', border: '#f39c12', icon: '#f39c12', text: '#fff3cd' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id'>): string => {
    const id = generateId();
    const newToast: Toast = { ...toast, id };
    setToasts(prev => [...prev, newToast]);

    if (toast.duration !== 0) {
      const duration = toast.duration ?? 4000;
      const timer = setTimeout(() => {
        removeToast(id);
      }, duration);
      timersRef.current.set(id, timer);
    }

    return id;
  }, [removeToast]);

  const success = useCallback((title: string, message?: string, duration?: number) =>
    addToast({ type: 'success', title, message, duration }), [addToast]);

  const error = useCallback((title: string, message?: string, duration?: number) =>
    addToast({ type: 'error', title, message, duration }), [addToast]);

  const info = useCallback((title: string, message?: string, duration?: number) =>
    addToast({ type: 'info', title, message, duration }), [addToast]);

  const warning = useCallback((title: string, message?: string, duration?: number) =>
    addToast({ type: 'warning', title, message, duration }), [addToast]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const value: ToastContextValue = { toasts, addToast, removeToast, success, error, info, warning };

  return createElement(
    ToastContext.Provider,
    { value },
    children,
    // Toast container - rendered at the portal level
    createElement('div', {
      style: {
        position: 'fixed',
        top: '16px',
        right: '16px',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: '420px',
        width: '100%',
        pointerEvents: 'none',
      } as React.CSSProperties,
    },
      toasts.map(toast => {
        const colors = COLORS[toast.type];
        return createElement('div', {
          key: toast.id,
          style: {
            pointerEvents: 'auto',
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: '10px',
            padding: '14px 16px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            animation: 'toastSlideIn 0.25s ease-out',
            backdropFilter: 'blur(12px)',
          } as React.CSSProperties,
        },
          // Icon
          createElement('div', {
            style: {
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: colors.icon + '22',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: 700,
              color: colors.icon,
              flexShrink: 0,
              marginTop: '1px',
            } as React.CSSProperties,
          }, ICONS[toast.type]),
          // Content
          createElement('div', {
            style: { flex: 1, minWidth: 0 } as React.CSSProperties,
          },
            createElement('div', {
              style: {
                color: '#fff',
                fontSize: '14px',
                fontWeight: 600,
                lineHeight: 1.4,
                marginBottom: toast.message ? '4px' : '0',
              } as React.CSSProperties,
            }, toast.title),
            toast.message ? createElement('div', {
              style: {
                color: colors.text,
                fontSize: '13px',
                lineHeight: 1.4,
                wordBreak: 'break-word',
              } as React.CSSProperties,
            }, toast.message) : null,
          ),
          // Close button
          createElement('button', {
            onClick: () => removeToast(toast.id),
            style: {
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '2px 4px',
              lineHeight: 1,
              flexShrink: 0,
              borderRadius: '4px',
            } as React.CSSProperties,
            onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = '#ffffff11'),
            onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = 'none'),
          }, '✕'),
        );
      })
    )
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// ─── Global styles (injected once) ───────────────────────────────────────────

const styleId = 'toast-styles';
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes toastSlideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);
}
