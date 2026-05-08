import {
	FolderOpen,
	Image,
	Keyboard,
	LayoutDashboard,
	MonitorSmartphone,
	Settings,
	ShieldCheck,
	UserCircle,
	LogOut,
	Users,
	Download,
	Eye,
	X,
	Globe,
	Cookie,
	Scan,
} from 'lucide-react'
import { useEffect } from 'react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useDashboardStore } from '../store/dashboardStore.ts'
import { useBridgeWebSocket } from '../hooks/BridgeWebSocketProvider'
import { useClientSync } from '../hooks/useClientSync'

interface AdminLayoutProps {
	user: {
		id: string;
		username: string;
		role: 'admin' | 'user';
	};
	onLogout: () => void;
}

const navItems = [
	{ to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
	{ to: '/admin/clients', label: 'Clients', icon: MonitorSmartphone },
	{ to: '/admin/process-injection', label: 'Process Injection', icon: ShieldCheck },
	{ to: '/admin/files', label: 'Files', icon: FolderOpen },
	{ to: '/admin/screenshots', label: 'Screenshots', icon: Image },{ to: '/admin/stream', label: 'Remote Access', icon: Image },
	{ to: '/admin/keylogs', label: 'Keylogs', icon: Keyboard },
	{ to: '/admin/cookies', label: 'Cookies', icon: Cookie },
	{ to: '/admin/scanned-data', label: 'Scanned Data', icon: Scan },
	{ to: '/admin/rat-download', label: 'RAT Download', icon: Download },
	{ to: '/admin/user-management', label: 'User Management', icon: Users },
	{ to: '/admin/settings', label: 'Settings', icon: Settings },
]

export default function AdminLayout({ user, onLogout }: AdminLayoutProps) {
	const { impersonateUserId, impersonateUsername, clearImpersonation } = useDashboardStore()
	const { send, isConnected } = useBridgeWebSocket()
	useClientSync()

	useEffect(() => {
		if (!isConnected) return
		send({
			type: 'set_impersonation',
			impersonateUserId: impersonateUserId ?? null,
		})
	}, [isConnected, impersonateUserId, send])

	// Only admin can access admin layout
	if (user.role !== 'admin') {
		return <Navigate to="/" replace />
	}

	return (
		<div className="grid h-screen grid-cols-1 overflow-hidden bg-slate-950 text-slate-100 lg:grid-cols-[270px_1fr]">
			<aside className="flex min-h-0 flex-col border-b border-slate-800 bg-slate-900/70 lg:border-b-0 lg:border-r">
				<div className="border-b border-slate-800 p-4 lg:p-6">
					<div className="flex items-center gap-3">
						<div className="rounded-xl bg-brand-600/20 p-2 text-brand-500">
							<ShieldCheck className="size-5" />
						</div>
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">C2 Console</p>
							<h1 className="text-lg font-semibold text-slate-100">Management</h1>
						</div>
					</div>
				</div>

				<nav className="min-h-0 space-y-2 overflow-y-auto p-4 lg:p-6">
					{navItems.map(({ to, label, icon: Icon }) => (
						<NavLink
							key={to}
							to={to}
							className={({ isActive }) =>
								`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
									isActive
										? 'border border-dashed border-brand-500 bg-brand-600/20 text-brand-500'
										: 'text-slate-300 hover:bg-slate-800/80 hover:text-slate-100'
								}`
							}
						>
							<Icon className="size-4" />
							{label}
						</NavLink>
					))}
				</nav>
			</aside>

			<main className="flex min-w-0 min-h-0 flex-col">
				{impersonateUserId && (
					<div className="mx-4 mt-4 rounded-lg border border-amber-500/40 bg-amber-900/20 px-4 py-3 text-amber-200 lg:mx-8">
						<div className="flex items-center justify-between gap-3">
							<div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em]">
								<Eye className="size-4" />
								<span>Viewing As: {impersonateUsername || impersonateUserId}</span>
							</div>
							<button
								onClick={clearImpersonation}
								className="inline-flex items-center gap-1 rounded border border-amber-400/50 px-2 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/20"
							>
								<X className="size-3.5" />
								EXIT
							</button>
						</div>
					</div>
				)}

				<header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-4 lg:px-8">
					<div>
						<p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Operations</p>
						<h2 className="text-base font-semibold text-slate-100">Admin Control Plane</h2>
					</div>

					<div className="flex items-center gap-3">
						<div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200">
							<UserCircle className="size-4" />
							<span>{user.username}</span>
							<span className={`px-2 py-1 text-xs rounded ${user.role === 'admin' ? 'bg-purple-600/20 text-purple-400' : 'bg-blue-600/20 text-blue-400'}`}>
								{user.role}
							</span>
						</div>
						<button
							onClick={() => {
								send({ type: 'set_impersonation', impersonateUserId: null })
								clearImpersonation()
								onLogout()
							}}
							className="inline-flex items-center gap-2 rounded-lg border border-red-700/30 bg-red-900/20 px-3 py-2 text-sm text-red-300 hover:bg-red-900/40 hover:text-red-200 transition"
						>
							<LogOut className="size-4" />
							Logout
						</button>
					</div>
				</header>

				<section className="main-scrollbar min-h-0 overflow-y-auto overflow-x-hidden p-4 lg:p-8">
					<Outlet />
				</section>
			</main>
		</div>
	)
}
