import { useEffect, useRef } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

export interface ConfirmModalProps {
    open: boolean;
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ConfirmModal({
    open,
    title = 'Confirm Action',
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'danger',
    onConfirm,
    onCancel,
}: ConfirmModalProps) {
    const confirmRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (open) {
            const t = setTimeout(() => confirmRef.current?.focus(), 50);
            return () => clearTimeout(t);
        }
    }, [open]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!open) return;
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onCancel]);

    if (!open) return null;

    const accentColor =
        variant === 'danger' ? '#ff4444' :
        variant === 'warning' ? '#ffaa00' :
        '#00d4ff';

    const iconBg =
        variant === 'danger' ? 'rgba(255,68,68,0.12)' :
        variant === 'warning' ? 'rgba(255,170,0,0.12)' :
        'rgba(0,212,255,0.12)';

    const Icon = variant === 'danger' ? Trash2 : AlertTriangle;

    return (
        <>
            <style>{`
                @keyframes cm-backdrop-in {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }
                @keyframes cm-panel-in {
                    from { opacity: 0; transform: scale(0.93) translateY(-10px); }
                    to   { opacity: 1; transform: scale(1)   translateY(0); }
                }
                .cm-backdrop {
                    animation: cm-backdrop-in 0.15s ease forwards;
                }
                .cm-panel {
                    animation: cm-panel-in 0.18s cubic-bezier(0.34,1.2,0.64,1) forwards;
                }
                .cm-confirm-btn {
                    position: relative;
                    overflow: hidden;
                    transition: box-shadow 0.2s, transform 0.15s;
                }
                .cm-confirm-btn::before {
                    content: '';
                    position: absolute;
                    top: 0; left: -100%;
                    width: 100%; height: 100%;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent);
                    transition: left 0.4s ease;
                }
                .cm-confirm-btn:hover::before { left: 100%; }
                .cm-confirm-btn:hover { transform: translateY(-1px); }
                .cm-confirm-btn:active { transform: scale(0.97); }
                .cm-cancel-btn {
                    transition: background 0.2s, border-color 0.2s;
                }
                .cm-cancel-btn:hover {
                    background: rgba(255,255,255,0.07) !important;
                    border-color: rgba(255,255,255,0.3) !important;
                }
            `}</style>

            {/* Backdrop */}
            <div
                className="cm-backdrop"
                onClick={onCancel}
                style={{
                    position: 'fixed', inset: 0,
                    background: 'rgba(0,0,0,0.72)',
                    backdropFilter: 'blur(3px)',
                    zIndex: 9998,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
            >
                {/* Panel */}
                <div
                    className="cm-panel"
                    onClick={e => e.stopPropagation()}
                    style={{
                        width: '100%', maxWidth: '380px',
                        background: '#0d1117',
                        border: `1px solid ${accentColor}55`,
                        borderRadius: '6px',
                        boxShadow: `0 0 40px ${accentColor}22, 0 20px 60px rgba(0,0,0,0.6)`,
                        fontFamily: "'Courier New', monospace",
                        zIndex: 9999,
                        overflow: 'hidden',
                    }}
                >
                    {/* Top bar */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderBottom: `1px solid ${accentColor}33`,
                        background: `${accentColor}0a`,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: accentColor, fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', fontWeight: 700 }}>
                                ⚠ {title}
                            </span>
                        </div>
                        <button
                            onClick={onCancel}
                            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: '2px' }}
                        >
                            <X size={14} />
                        </button>
                    </div>

                    {/* Body */}
                    <div style={{ padding: '24px 20px' }}>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: '28px' }}>
                            <div style={{
                                flexShrink: 0,
                                width: '38px', height: '38px',
                                borderRadius: '4px',
                                background: iconBg,
                                border: `1px solid ${accentColor}44`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Icon size={18} color={accentColor} />
                            </div>
                            <p style={{
                                margin: 0,
                                color: 'rgba(255,255,255,0.8)',
                                fontSize: '13px',
                                lineHeight: '1.6',
                                letterSpacing: '0.3px',
                            }}>
                                {message}
                            </p>
                        </div>

                        {/* Buttons */}
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                            <button
                                onClick={onCancel}
                                className="cm-cancel-btn"
                                style={{
                                    padding: '9px 20px',
                                    background: 'transparent',
                                    border: '1px solid rgba(255,255,255,0.18)',
                                    borderRadius: '4px',
                                    color: 'rgba(255,255,255,0.55)',
                                    fontSize: '11px',
                                    fontFamily: "'Courier New', monospace",
                                    letterSpacing: '2px',
                                    textTransform: 'uppercase',
                                    cursor: 'pointer',
                                    fontWeight: 700,
                                }}
                            >
                                {cancelLabel}
                            </button>
                            <button
                                ref={confirmRef}
                                onClick={onConfirm}
                                className="cm-confirm-btn"
                                style={{
                                    padding: '9px 22px',
                                    background: `${accentColor}18`,
                                    border: `1px solid ${accentColor}`,
                                    borderRadius: '4px',
                                    color: accentColor,
                                    fontSize: '11px',
                                    fontFamily: "'Courier New', monospace",
                                    letterSpacing: '2px',
                                    textTransform: 'uppercase',
                                    cursor: 'pointer',
                                    fontWeight: 700,
                                    boxShadow: `0 0 10px ${accentColor}33`,
                                }}
                            >
                                {confirmLabel}
                            </button>
                        </div>
                    </div>

                    {/* Bottom scan line */}
                    <div style={{
                        height: '2px',
                        background: `linear-gradient(90deg, transparent, ${accentColor}88, transparent)`,
                    }} />
                </div>
            </div>
        </>
    );
}
