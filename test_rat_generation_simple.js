const http = require('http');

// Simple test to check if the endpoint exists
function testEndpointExists() {
    console.log('Testing if RAT generation endpoint exists...\n');
    
    // First, get an auth token
    const loginData = JSON.stringify({
        username: 'admin',
        password: 'admin123'
    });
    
    const loginOptions = {
        hostname: 'localhost',
        port: 8081,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': loginData.length
        }
    };
    
    const loginReq = http.request(loginOptions, (loginRes) => {
        let data = '';
        
        loginRes.on('data', (chunk) => {
            data += chunk;
        });
        
        loginRes.on('end', () => {
            try {
                const response = JSON.parse(data);
                
                if (response.success && response.token) {
                    console.log('✓ Login successful');
                    
                    // Test if endpoint exists with a timeout
                    testGenerateRatEndpoint(response.token);
                } else {
                    console.log('✗ Login failed:', response.error);
                }
            } catch (error) {
                console.log('✗ Error parsing login response:', error.message);
            }
        });
    });
    
    loginReq.on('error', (error) => {
        console.log('✗ Login request error:', error.message);
    });
    
    loginReq.write(loginData);
    loginReq.end();
}

function testGenerateRatEndpoint(token) {
    console.log('\nTesting RAT generation endpoint...');
    
    const ratData = JSON.stringify({
        target_user_id: 2
    });
    
    const options = {
        hostname: 'localhost',
        port: 8081,
        path: '/api/auth/generate-rat',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Content-Length': ratData.length
        },
        timeout: 10000 // 10 second timeout
    };
    
    const req = http.request(options, (res) => {
        console.log(`Response status: ${res.statusCode}`);
        
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log('Response body:', data);
            
            if (res.statusCode === 200) {
                console.log('✓ Endpoint exists and is responding!');
            } else if (res.statusCode === 404) {
                console.log('✗ Endpoint not found (404)');
            } else {
                console.log(`✗ Endpoint returned status: ${res.statusCode}`);
            }
        });
    });
    
    req.on('timeout', () => {
        console.log('✗ Request timed out - endpoint might be compiling (this is expected for first run)');
        req.destroy();
    });
    
    req.on('error', (error) => {
        console.log('✗ Request error:', error.message);
    });
    
    req.write(ratData);
    req.end();
}

// Run the test
testEndpointExists();