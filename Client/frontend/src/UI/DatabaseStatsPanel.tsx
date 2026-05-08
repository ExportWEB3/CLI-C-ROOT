import React from 'react';
import { useStatisticsQuery } from '../hooks/useDatabaseQuery';
import { Button } from './Button';

interface DatabaseStatsPanelProps {
  className?: string;
  refreshInterval?: number;
}

export function DatabaseStatsPanel({ className = '', refreshInterval = 30000 }: DatabaseStatsPanelProps) {
  const { data, isLoading, isError, error, refetch } = useStatisticsQuery();

  // Auto-refresh
  React.useEffect(() => {
    if (!refreshInterval) return;
    
    const interval = setInterval(() => {
      refetch().catch(() => {
        // Ignore errors in auto-refresh
      });
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval, refetch]);

  if (isLoading) {
    return (
      <div className={`border rounded-lg p-4 ${className}`}>
        <h3 className="text-lg font-semibold mb-4">Database Statistics</h3>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="h-4 bg-gray-200 rounded w-24 animate-pulse"></div>
              <div className="h-8 bg-gray-200 rounded w-12 animate-pulse"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={`border border-red-300 rounded-lg p-4 bg-red-50 ${className}`}>
        <h3 className="text-lg font-semibold mb-2 text-red-800">Database Statistics</h3>
        <div className="text-red-600">
          Failed to load database statistics: {error}
        </div>
      </div>
    );
  }

  const stats = data || {
    totalClients: 0,
    onlineClients: 0,
    totalScreenshots: 0,
    totalKeylogs: 0,
    totalCommands: 0,
    databaseSize: 0,
    recentActivity: {
      screenshots: 0,
      keylogs: 0,
      commands: 0
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const statItems = [
    { title: 'Total Clients', value: stats.totalClients, description: `${stats.onlineClients} online` },
    { title: 'Screenshots', value: stats.totalScreenshots, description: `${stats.recentActivity?.screenshots || 0} last 24h` },
    { title: 'Keylogs', value: stats.totalKeylogs, description: `${stats.recentActivity?.keylogs || 0} last 24h` },
    { title: 'Commands', value: stats.totalCommands, description: `${stats.recentActivity?.commands || 0} last 24h` },
    { title: 'Database Size', value: formatBytes(stats.databaseSize), description: 'Total storage' },
    { 
      title: 'Activity', 
      value: (stats.recentActivity?.screenshots || 0) +
             (stats.recentActivity?.keylogs || 0) +
             (stats.recentActivity?.commands || 0),
      description: 'Last 24h total' 
    }
  ];

  return (
    <div className={`border rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Database Statistics</h3>
        <Button
          onClick={() => refetch()}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors px-2 py-1 border rounded"
          title="Refresh statistics"
          isLoading={isLoading}
          variant="secondary"
          size="sm"
        >
          Refresh
        </Button>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {statItems.map((item) => (
          <div
            key={item.title}
            className="flex flex-col items-center justify-center p-3 rounded border bg-gray-50"
          >
            <div className="text-xl font-bold">{typeof item.value === 'number' ? formatNumber(item.value) : item.value}</div>
            <div className="text-sm font-medium text-center">{item.title}</div>
            <div className="text-xs text-gray-500 mt-1 text-center">{item.description}</div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="mt-6 pt-6 border-t">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-sm text-gray-500">Client Status</div>
            <div className="text-lg font-semibold">
              <span className="text-green-600">{stats.onlineClients}</span>
              <span className="text-gray-400"> / </span>
              <span>{stats.totalClients}</span>
            </div>
            <div className="text-xs text-gray-500">Online / Total</div>
          </div>
          
          <div className="text-center">
            <div className="text-sm text-gray-500">Daily Activity</div>
            <div className="text-lg font-semibold">
              {formatNumber(
                (stats.recentActivity?.screenshots || 0) +
                (stats.recentActivity?.keylogs || 0) +
                (stats.recentActivity?.commands || 0)
              )}
            </div>
            <div className="text-xs text-gray-500">Events today</div>
          </div>
          
          <div className="text-center">
            <div className="text-sm text-gray-500">Storage</div>
            <div className="text-lg font-semibold">{formatBytes(stats.databaseSize)}</div>
            <div className="text-xs text-gray-500">Database size</div>
          </div>
        </div>
      </div>

      {/* Last updated */}
      <div className="mt-4 text-xs text-gray-500 text-center">
        Last updated: {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}
