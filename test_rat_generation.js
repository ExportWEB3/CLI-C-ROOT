const http = require('http');

// Test the RAT generation API
function testRatGeneration() {
    console.log('Testing RAT Generation API...\n');
    
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
                    console.log(`Token: ${response.token.substring(0, 20)}...`);
                    console.log(`User ID: ${response.user.id}, Role: ${response.user.role}\n`);
                    
                    // Now test RAT generation for user ID 2
                    testGenerateRat(response.token, 2);
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

function testGenerateRat(token, userId) {
    console.log(`Testing RAT generation for user ID: ${userId}...`);
    
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
    
    const req = http.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            try {
                const response = JSON.parse(data);
                
                if (response.success) {
                    console.log('✓ RAT generation successful!');
                    console.log(`Message: ${response.message}`);
                    console.log(`Download URL: ${response.download_url}`);
                    console.log(`File path: ${response.file_path}`);
                    
                    // Test download
                    testDownloadRat(token, userId);
                } else {
                    console.log('✗ RAT generation failed:', response.error);
                }
            } catch (error) {
                console.log('✗ Error parsing RAT generation response:', error.message);
                console.log('Raw response:', data);
            }
        });
    });
    
    req.on('error', (error) => {
        console.log('✗ RAT generation request error:', error.message);
    });
    
    req.write(ratData);
    req.end();
}

function testDownloadRat(token, userId) {
    console.log(`\nTesting RAT download for user ID: ${userId}...`);
    
    const options = {
        hostname: 'localhost',
        port: 8081,
        path: `/api/auth/download-rat/${userId}`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    };
    
    const req = http.request(options, (res) => {
        console.log(`Download response status: ${res.statusCode}`);
        console.log(`Content-Type: ${res.headers['content-type']}`);
        console.log(`Content-Disposition: ${res.headers['content-disposition']}`);
        console.log(`Content-Length: ${res.headers['content-length']} bytes`);
        
        if (res.statusCode === 200) {
            console.log('✓ RAT download successful!');
            
            // Save the file
            const fs = require('fs');
            const fileStream = fs.createWriteStream(`rat_user_${userId}_test.exe`);
            
            res.on('data', (chunk) => {
                fileStream.write(chunk);
            });
            
            res.on('end', () => {
                fileStream.end();
                console.log(`✓ RAT file saved as: rat_user_${userId}_test.exe`);
                console.log('\n=== Test completed successfully! ===');
            });
        } else {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    console.log('✗ Download failed:', response.error);
                } catch (error) {
                    console.log('✗ Download failed with status:', res.statusCode);
                }
            });
        }
    });
    
    req.on('error', (error) => {
        console.log('✗ Download request error:', error.message);
    });
    
    req.end();
}

// Run the test
testRatGeneration();