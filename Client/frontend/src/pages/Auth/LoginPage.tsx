import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface LoginFormData {
    username: string;
    password: string;
}

interface AuthUser {
    id: string;
    username: string;
    role: 'admin' | 'user';
}

interface LoginPageProps {
    onLogin: (user: AuthUser) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
    const navigate = useNavigate();
    const [loginData, setLoginData] = useState<LoginFormData>({ username: '', password: '' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(loginData)
            });

            const data = await response.json();

            if (response.ok) {
                const sessionResponse = await fetch('/api/auth/me', {
                    method: 'GET',
                    credentials: 'include',
                });

                if (!sessionResponse.ok) {
                    setError('Session cookie was not created. Check auth API/proxy settings.');
                    return;
                }

                const sessionData = await sessionResponse.json();
                onLogin(sessionData.user as AuthUser);
                
                // Redirect to dashboard
                navigate('/admin/dashboard');
            } else {
                setError(data.error || 'Login failed');
            }
        } catch (err) {
            setError('Network error. Please check if the auth server is running.');
            console.error('Login error:', err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-950 p-4">
            <style>{`
                .cyber-btn {
                    position: relative;
                    width: 100%;
                    padding: 14px;
                    background: transparent;
                    border: 1px solid #00d4ff;
                    border-radius: 4px;
                    color: #00d4ff;
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 13px;
                    font-weight: 700;
                    letter-spacing: 4px;
                    text-transform: uppercase;
                    cursor: pointer;
                    box-shadow: 0 0 12px rgba(0,212,255,0.25), inset 0 0 12px rgba(0,212,255,0.04);
                    transition: all 0.2s ease;
                    overflow: hidden;
                }
                .cyber-btn::before {
                    content: '';
                    position: absolute;
                    top: 0; left: -100%;
                    width: 100%; height: 100%;
                    background: linear-gradient(90deg, transparent, rgba(0,212,255,0.12), transparent);
                    transition: left 0.5s ease;
                }
                .cyber-btn:hover::before { left: 100%; }
                .cyber-btn:hover {
                    background: rgba(0,212,255,0.07);
                    box-shadow: 0 0 22px rgba(0,212,255,0.55), inset 0 0 18px rgba(0,212,255,0.08);
                    color: #fff;
                    border-color: #00d4ff;
                }
                .cyber-btn:active { transform: scale(0.98); }
                .cyber-btn:disabled { opacity: 0.45; cursor: not-allowed; }
                .cyber-btn:disabled::before { display: none; }
                @keyframes cyber-blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0; }
                }
                .cyber-cursor { animation: cyber-blink 1s step-end infinite; }
            `}</style>
            <div className="w-full max-w-sm rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-6">
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-semibold text-slate-100 m-0">
                        C2 Dashboard
                    </h1>
                    <p className="text-sm text-slate-400 mt-2">
                        Remote Administration Tool
                    </p>
                </div>

                <div className="flex mb-6 bg-slate-950 rounded-lg p-1 border border-slate-800">
                    <button
                        style={{
                            flex: 1,
                            padding: '12px',
                            background: 'rgba(255, 255, 255, 0.2)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'default',
                            fontSize: '16px',
                            fontWeight: '500',
                        }}
                    >
                        Login
                    </button>
                </div>

                {error && (
                    <div style={{
                        background: 'rgba(255, 87, 87, 0.2)',
                        border: '1px solid rgba(255, 87, 87, 0.3)',
                        color: '#ff5757',
                        padding: '12px',
                        borderRadius: '8px',
                        marginBottom: '20px',
                        fontSize: '14px'
                    }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleLogin}>
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{
                            display: 'block',
                            color: 'rgba(255, 255, 255, 0.9)',
                            marginBottom: '8px',
                            fontSize: '14px',
                            fontWeight: '500'
                        }}>
                            Username
                        </label>
                        <input
                            type="text"
                            value={loginData.username}
                            onChange={(e) => setLoginData({...loginData, username: e.target.value})}
                            required
                            style={{
                                width: '100%',
                                padding: '12px 16px',
                                background: 'rgba(255, 255, 255, 0.1)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                borderRadius: '8px',
                                color: 'white',
                                fontSize: '16px',
                                outline: 'none',
                                transition: 'all 0.3s'
                            }}
                            placeholder="Enter username"
                        />
                    </div>

                    <div style={{ marginBottom: '30px' }}>
                        <label style={{
                            display: 'block',
                            color: 'rgba(255, 255, 255, 0.9)',
                            marginBottom: '8px',
                            fontSize: '14px',
                            fontWeight: '500'
                        }}>
                            Password
                        </label>
                        <input
                            type="password"
                            value={loginData.password}
                            onChange={(e) => setLoginData({...loginData, password: e.target.value})}
                            required
                            style={{
                                width: '100%',
                                padding: '12px 16px',
                                background: 'rgba(255, 255, 255, 0.1)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                borderRadius: '8px',
                                color: 'white',
                                fontSize: '16px',
                                outline: 'none',
                                transition: 'all 0.3s'
                            }}
                            placeholder="Enter password"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="cyber-btn"
                    >
                        {loading
                            ? <span>&gt; AUTHENTICATING<span className="cyber-cursor">_</span></span>
                            : <span>&gt; AUTHENTICATE</span>
                        }
                    </button>
                </form>
            </div>
        </div>
    );
}
