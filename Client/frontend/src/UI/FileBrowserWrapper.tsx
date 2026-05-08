import { useState, useEffect, useCallback } from 'react';
import FileBrowser, { type FileSystemNode, type FileSystemEntry, type FileSystemType } from './FileBrowser';

interface FileBrowserWrapperProps {
  clientId: string;
  className?: string;
  onSendCommand: (clientId: string, command: string) => void;
  messages: Array<{
    type: string;
    clientId: string;
    output?: any;
    data?: any;
    timestamp: number;
  }>;
}

interface FileInfo {
  name: string;
  size: number;
  isDirectory: boolean;
  lastModified: string;
  permissions: string;
}

interface DirectoryResponse {
  path: string;
  files: FileInfo[];
}

interface DriveInfo {
  letter: string;
  type: number;
  volumeName: string;
  fileSystem: string;
  totalBytes: number;
  freeBytes: number;
}

interface DrivesResponse {
  drives: DriveInfo[];
}

export default function FileBrowserWrapper({ 
  clientId, 
  className, 
  onSendCommand, 
  messages 
}: FileBrowserWrapperProps) {
  const [currentPath, setCurrentPath] = useState<string>('C:\\');
  const [tree, setTree] = useState<FileSystemNode[]>([]);
  const [entries, setEntries] = useState<FileSystemEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [showProperties, setShowProperties] = useState<any>(null);
  const [showPreview, setShowPreview] = useState<any>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');

  // Convert FileInfo to FileSystemEntry
  const convertToFileSystemEntry = (file: FileInfo, basePath: string): FileSystemEntry => {
    const path = basePath.endsWith('\\') ? `${basePath}${file.name}` : `${basePath}\\${file.name}`;
    return {
      name: file.name,
      path,
      type: file.isDirectory ? 'folder' as FileSystemType : 'file' as FileSystemType,
      size: file.isDirectory ? '-' : formatFileSize(file.size),
      modifiedAt: file.lastModified
    };
  };

  // Convert FileInfo to FileSystemNode
  const convertToFileSystemNode = (file: FileInfo, basePath: string): FileSystemNode => {
    const path = basePath.endsWith('\\') ? `${basePath}${file.name}` : `${basePath}\\${file.name}`;
    return {
      name: file.name,
      path,
      type: file.isDirectory ? 'folder' as FileSystemType : 'file' as FileSystemType,
      children: file.isDirectory ? [] : undefined
    };
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Load directory
  const loadDirectory = useCallback((path: string) => {
    if (!clientId) return;
    
    setLoading(true);
    setError(null);
    
    // Send list_dir command
    onSendCommand(clientId, `list_dir ${path}`);
  }, [clientId, onSendCommand]);

  // Load drives
  const loadDrives = useCallback(() => {
    if (!clientId) return;
    
    setLoading(true);
    setError(null);
    
    // Send list_drives command
    onSendCommand(clientId, 'list_drives');
  }, [clientId, onSendCommand]);

  // Handle navigation
  const handleNavigate = useCallback((path: string) => {
    if (path === '/') {
      // Root - show drives
      loadDrives();
      setCurrentPath('/');
    } else if (path.startsWith('/')) {
      // Unix-style path, convert to Windows
      const windowsPath = path.substring(1).replace(/\//g, '\\');
      if (windowsPath.length === 0) {
        loadDrives();
        setCurrentPath('/');
      } else {
        loadDirectory(windowsPath);
        setCurrentPath(windowsPath);
      }
    } else {
      // Windows path
      loadDirectory(path);
      setCurrentPath(path);
    }
  }, [loadDirectory, loadDrives]);

  // Handle download
  const handleDownload = useCallback((filePath: string) => {
    if (!clientId) return;
    
    onSendCommand(clientId, `download ${filePath}`);
  }, [clientId, onSendCommand]);

  // Handle upload - sends file data via the bridge
  const handleUpload = useCallback(async (targetPath: string, file: File) => {
    if (!clientId) return;
    
    // Read file as base64
    const reader = new FileReader();
    const base64Data = await new Promise<string>((resolve, reject) => {
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data:...;base64, prefix
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    
    // Build the full path
    const fullPath = targetPath.endsWith('\\') 
      ? `${targetPath}${file.name}` 
      : `${targetPath}\\${file.name}`;
    
    // Send upload command with file data
    // Format: upload <path>|<base64>|<size>
    onSendCommand(clientId, `upload ${fullPath}|${base64Data}|${file.size}`);
    
    // Refresh after a short delay
    setTimeout(() => loadDirectory(targetPath), 1000);
  }, [clientId, onSendCommand, loadDirectory]);

  // Handle mkdir (create folder)
  const handleMkdir = useCallback((parentPath: string, dirName: string) => {
    if (!clientId || !parentPath || !dirName) return;
    const fullPath = parentPath.endsWith('\\') ? `${parentPath}${dirName}` : `${parentPath}\\${dirName}`;
    onSendCommand(clientId, `mkdir ${fullPath}`);
    // Refresh after a short delay
    setTimeout(() => loadDirectory(parentPath), 500);
  }, [clientId, onSendCommand, loadDirectory]);

  // Handle touch (create empty file)
  const handleTouch = useCallback((parentPath: string, fileName: string) => {
    if (!clientId || !parentPath || !fileName) return;
    const fullPath = parentPath.endsWith('\\') ? `${parentPath}${fileName}` : `${parentPath}\\${fileName}`;
    onSendCommand(clientId, `touch ${fullPath}`);
    // Refresh after a short delay
    setTimeout(() => loadDirectory(parentPath), 500);
  }, [clientId, onSendCommand, loadDirectory]);

  // Handle rename
  const handleRename = useCallback((oldPath: string, newName: string) => {
    if (!clientId || !oldPath || !newName) return;
    
    // Extract directory from old path
    const lastBackslash = oldPath.lastIndexOf('\\');
    const directory = lastBackslash >= 0 ? oldPath.substring(0, lastBackslash) : '';
    const newPath = directory ? `${directory}\\${newName}` : newName;
    
    onSendCommand(clientId, `rename ${oldPath}|${newPath}`);
    setRenameTarget(null);
    setRenameValue('');
    // Refresh after a short delay
    setTimeout(() => loadDirectory(currentPath), 500);
  }, [clientId, onSendCommand, loadDirectory, currentPath]);

  // Handle delete
  const handleDelete = useCallback((filePath: string, isDirectory: boolean) => {
    if (!clientId || !filePath) return;
    
    if (isDirectory) {
      onSendCommand(clientId, `rm_rf ${filePath}`);
    } else {
      onSendCommand(clientId, `rm ${filePath}`);
    }
    // Refresh after a short delay
    setTimeout(() => loadDirectory(currentPath), 500);
  }, [clientId, onSendCommand, loadDirectory, currentPath]);

  // Handle zip
  const handleZip = useCallback((path: string) => {
    if (!clientId || !path) return;
    onSendCommand(clientId, `zip ${path}`);
  }, [clientId, onSendCommand]);

  // Handle unzip
  const handleUnzip = useCallback((zipPath: string, outputDir: string) => {
    if (!clientId || !zipPath || !outputDir) return;
    onSendCommand(clientId, `unzip ${zipPath}|${outputDir}`);
  }, [clientId, onSendCommand]);

  // Handle search
  const handleSearch = useCallback(() => {
    if (!clientId || !searchQuery) return;
    
    const root = currentPath === '/' ? 'C:\\' : currentPath;
    onSendCommand(clientId, `search ${root}|${searchQuery}|100`);
    setShowSearch(true);
  }, [clientId, searchQuery, currentPath, onSendCommand]);

  // Handle properties
  const handleProperties = useCallback((filePath: string) => {
    if (!clientId || !filePath) return;
    
    onSendCommand(clientId, `properties ${filePath}`);
  }, [clientId, onSendCommand]);

  // Handle preview
  const handlePreview = useCallback((filePath: string) => {
    if (!clientId || !filePath) return;
    
    onSendCommand(clientId, `preview ${filePath}|50`);
  }, [clientId, onSendCommand]);

  // Process WebSocket messages
  useEffect(() => {
    if (!messages.length) return;

    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage.type === 'file_browser_data' && lastMessage.clientId === clientId) {
      setLoading(false);
      
      const data = lastMessage.data;
      
      if (data && typeof data === 'object') {
        // Check if it's a directory listing
        if ('files' in data) {
          const dirResponse = data as DirectoryResponse;
          
          // Convert files to entries
          const newEntries = dirResponse.files.map(file => 
            convertToFileSystemEntry(file, dirResponse.path)
          );
          
          // Convert files to tree nodes (only directories)
          const newTreeNodes = dirResponse.files
            .filter(file => file.isDirectory)
            .map(file => convertToFileSystemNode(file, dirResponse.path));
          
          setEntries(newEntries);
          setTree(newTreeNodes);
          setCurrentPath(dirResponse.path);
        }
        // Check if it's a drives listing
        else if ('drives' in data) {
          const drivesResponse = data as DrivesResponse;
          
          // Convert drives to entries
          const driveEntries: FileSystemEntry[] = drivesResponse.drives.map(drive => ({
            name: `${drive.letter} (${drive.volumeName || 'Local Disk'})`,
            path: drive.letter,
            type: 'folder' as FileSystemType,
            size: `${formatFileSize(drive.freeBytes)} free of ${formatFileSize(drive.totalBytes)}`,
            modifiedAt: ''
          }));
          
          // Convert drives to tree nodes
          const driveTreeNodes: FileSystemNode[] = drivesResponse.drives.map(drive => ({
            name: `${drive.letter} (${drive.volumeName || 'Local Disk'})`,
            path: drive.letter,
            type: 'folder' as FileSystemType,
            children: []
          }));
          
          setEntries(driveEntries);
          setTree(driveTreeNodes);
          setCurrentPath('/');
        }
      }
    } else if (lastMessage.type === 'file_browser_response' && lastMessage.clientId === clientId) {
      setLoading(false);
      
      const output = lastMessage.output;
      
      if (output && typeof output === 'object') {
        if ('files' in output) {
          const dirResponse = output as DirectoryResponse;
          const newEntries = dirResponse.files.map(file => 
            convertToFileSystemEntry(file, dirResponse.path)
          );
          const newTreeNodes = dirResponse.files
            .filter(file => file.isDirectory)
            .map(file => convertToFileSystemNode(file, dirResponse.path));
          setEntries(newEntries);
          setTree(newTreeNodes);
          setCurrentPath(dirResponse.path);
        } else if ('drives' in output) {
          const drivesResponse = output as DrivesResponse;
          const driveEntries: FileSystemEntry[] = drivesResponse.drives.map(drive => ({
            name: `${drive.letter} (${drive.volumeName || 'Local Disk'})`,
            path: drive.letter,
            type: 'folder' as FileSystemType,
            size: `${formatFileSize(drive.freeBytes)} free of ${formatFileSize(drive.totalBytes)}`,
            modifiedAt: ''
          }));
          const driveTreeNodes: FileSystemNode[] = drivesResponse.drives.map(drive => ({
            name: `${drive.letter} (${drive.volumeName || 'Local Disk'})`,
            path: drive.letter,
            type: 'folder' as FileSystemType,
            children: []
          }));
          setEntries(driveEntries);
          setTree(driveTreeNodes);
          setCurrentPath('/');
        }
      }
    } else if (lastMessage.type === 'file_search_result' && lastMessage.clientId === clientId) {
      setLoading(false);
      const data = lastMessage.data;
      if (data && data.results) {
        setSearchResults(data.results);
      }
    } else if (lastMessage.type === 'file_properties' && lastMessage.clientId === clientId) {
      setLoading(false);
      setShowProperties(lastMessage.data);
    } else if (lastMessage.type === 'file_preview' && lastMessage.clientId === clientId) {
      setLoading(false);
      setShowPreview(lastMessage.data);
    } else if (lastMessage.type === 'client_output' && lastMessage.clientId === clientId) {
      const output = lastMessage.output;
      if (typeof output === 'string' && output.startsWith('ERROR:')) {
        setError(output);
        setLoading(false);
      }
    }
  }, [messages, clientId]);

  // Load initial directory on mount
  useEffect(() => {
    if (clientId) {
      loadDrives();
    }
  }, [clientId, loadDrives]);

  // Handle error messages
  useEffect(() => {
    if (error) {
      console.error('File browser error:', error);
    }
  }, [error]);

  if (!clientId) {
    return (
      <div className={`panel p-4 ${className || ''}`}>
        <div className="text-center text-slate-400">
          No client selected. Please select a client from the client list.
        </div>
      </div>
    );
  }

  return (
    <div>
      {loading && (
        <div className="mb-2 rounded-md bg-slate-800/50 p-2 text-center text-sm text-slate-300">
          Loading...
        </div>
      )}
      
      {error && (
        <div className="mb-2 rounded-md bg-red-900/30 border border-red-700 p-2 text-sm text-red-300">
          Error: {error}
        </div>
      )}
      
      <div className="mb-2 flex flex-wrap gap-2">
        <button
          onClick={() => handleNavigate('/')}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
        >
          Drives
        </button>
        <button
          onClick={() => handleNavigate(currentPath)}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
        >
          Refresh
        </button>
        <button
          onClick={() => onSendCommand(clientId, `cd ${currentPath}`)}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
        >
          Set as CWD
        </button>
        <button
          onClick={() => setShowSearch(!showSearch)}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
        >
          {showSearch ? 'Hide Search' : 'Search'}
        </button>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="mb-3 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search pattern (e.g. *.txt, *.docx, *password*)"
              className="flex-1 rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 border border-slate-700"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button
              onClick={handleSearch}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700"
            >
              Search
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-40 overflow-auto rounded border border-slate-700 bg-slate-950 p-2">
              <p className="mb-1 text-xs text-slate-400">Found {searchResults.length} files:</p>
              {searchResults.map((result, i) => (
                <div key={i} className="cursor-pointer truncate py-0.5 text-xs text-slate-300 hover:text-slate-100"
                     onClick={() => { handleNavigate(result); setShowSearch(false); }}>
                  {result}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Properties modal */}
      {showProperties && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowProperties(null)}>
          <div className="max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-semibold text-slate-100">File Properties</h3>
            <div className="space-y-2 text-sm text-slate-300">
              <div className="flex justify-between"><span className="text-slate-500">Name:</span><span>{showProperties.name}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Path:</span><span className="truncate max-w-xs">{showProperties.path}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Type:</span><span>{showProperties.isDirectory ? 'Directory' : 'File'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Size:</span><span>{showProperties.isDirectory ? '-' : formatFileSize(showProperties.size)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Created:</span><span>{showProperties.created}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Modified:</span><span>{showProperties.modified}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Accessed:</span><span>{showProperties.accessed}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Owner:</span><span>{showProperties.owner}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Attributes:</span><span>{showProperties.attributes}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Hidden:</span><span>{showProperties.hidden ? 'Yes' : 'No'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Read Only:</span><span>{showProperties.readonly ? 'Yes' : 'No'}</span></div>
            </div>
            <button onClick={() => setShowProperties(null)} className="mt-4 w-full rounded-md bg-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600">Close</button>
          </div>
        </div>
      )}

      {/* Preview modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowPreview(null)}>
          <div className="max-h-[80vh] max-w-2xl overflow-auto rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-base font-semibold text-slate-100">Preview: {showPreview.path?.split('\\').pop()}</h3>
            {showPreview.error ? (
              <p className="text-sm text-red-400">{showPreview.error}</p>
            ) : (
              <pre className="overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-300">
                {showPreview.lines?.join('\n') || '(empty file)'}
              </pre>
            )}
            <p className="mt-2 text-xs text-slate-500">{showPreview.lineCount} lines ({showPreview.truncated ? 'truncated' : 'complete'})</p>
            <button onClick={() => setShowPreview(null)} className="mt-3 w-full rounded-md bg-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600">Close</button>
          </div>
        </div>
      )}

      {/* Rename dialog */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setRenameTarget(null)}>
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-semibold text-slate-100">Rename</h3>
            <p className="mb-2 text-sm text-slate-400">Current: {renameTarget.split('\\').pop()}</p>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="New name"
              className="mb-3 w-full rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 border border-slate-700"
              onKeyDown={(e) => e.key === 'Enter' && handleRename(renameTarget, renameValue)}
            />
            <div className="flex gap-2">
              <button onClick={() => setRenameTarget(null)} className="flex-1 rounded-md bg-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600">Cancel</button>
              <button onClick={() => handleRename(renameTarget, renameValue)} className="flex-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700">Rename</button>
            </div>
          </div>
        </div>
      )}
      
      <FileBrowser
        tree={tree}
        entries={entries}
        currentPath={currentPath}
        onNavigate={handleNavigate}
        onDownload={handleDownload}
        onUpload={handleUpload}
        onMkdir={handleMkdir}
        onTouch={handleTouch}
        onDelete={handleDelete}
        onRename={handleRename}
        onZip={handleZip}
        onUnzip={handleUnzip}
        onProperties={handleProperties}
        onPreview={handlePreview}
        className={className}
      />

      {/* Action buttons for selected file */}
      {entries.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/30 p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">File Actions</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                const selected = entries.find(e => e.type === 'file');
                if (selected) handleProperties(selected.path);
              }}
              className="rounded-md bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
            >
              Properties
            </button>
            <button
              onClick={() => {
                const selected = entries.find(e => e.type === 'file');
                if (selected) handlePreview(selected.path);
              }}
              className="rounded-md bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
            >
              Preview
            </button>
            <button
              onClick={() => {
                const selected = entries[0];
                if (selected) { setRenameTarget(selected.path); setRenameValue(selected.name); }
              }}
              className="rounded-md bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
            >
              Rename
            </button>
            <button
              onClick={() => {
                const selected = entries[0];
                if (selected && confirm(`Delete ${selected.name}?`)) handleDelete(selected.path, selected.type === 'folder');
              }}
              className="rounded-md bg-red-900/50 px-2.5 py-1 text-xs text-red-300 hover:bg-red-800/50"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
