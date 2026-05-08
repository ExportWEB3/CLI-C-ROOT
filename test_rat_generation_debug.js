const http = require('http');

// Test the RAT generation API with debug logging
function testRatGenerationDebug() {
    console.log('Testing RAT Generation API with debug...\n');
    
    // First, get an auth token (assuming we have a test user)
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
    
    console.log('Sending login request to:', loginOptions.path);
    
    const loginReq = http.request(loginOptions, (loginRes) => {
        console.log('Login response status:', loginRes.statusCode);
        console.log('Login response headers:', loginRes.headers);
        
        let data = '';
        
        loginRes.on('data', (chunk) => {
            data += chunk;
        });
        
        loginRes.on('end', () => {
            console.log('Login response body:', data);
            
            try {
                const response = JSON.parse(data);
                
                if (response.success && response.token) {
                    console.log('\n✓ Login successful');
                    console.log(`Token: ${response.token.substring(0, 20)}...`);
                    console.log(`User ID: ${response.user.id}, Role: ${response.user.role}\n`);
                    
                    // Now test RAT generation for user ID 2
                    testGenerateRatDebug(response.token, 2);
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

function testGenerateRatDebug(token, userId) {
    console.log(`\nTesting RAT generation for user ID: ${userId}...`);
    
    const ratData = JSON.stringify({
        target_user_id: userId
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
        }
    };
    
    console.log('Sending RAT generation request to:', options.path);
    console.log('Request headers:', options.headers);
    
    const req = http.request(options, (res) => {
        console.log('\nRAT generation response status:', res.statusCode);
        console.log('RAT generation response headers:', res.headers);
        
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log('RAT generation response body:', data);
            
            try {
                const response = JSON.parse(data);
                
                if (response.success) {
                    console.log('\n✓ RAT generation successful!');
                    console.log(`Message: ${response.message}`);
                    console.log(`Download URL: ${response.download_url}`);
                    console.log(`File path: ${response.file_path}`);
                } else {
                    console.log('\n✗ RAT generation failed:', response.error);
                }
            } catch (error) {
                console.log('\n✗ Error parsing RAT generation response:', error.message);
                console.log('Raw response:', data);
            }
        });
    });
    
    req.on('error', (error) => {
        console.log('\n✗ RAT generation request error:', error.message);
    });
    
    req.write(ratData);
    req.end();
}

// Run the test
testRatGenerationDebug();