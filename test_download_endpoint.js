const http = require('http');
const fs = require('fs');

// Test the RAT download endpoint
function testDownloadEndpoint() {
    console.log('Testing RAT Download API...\n');
    
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
                    
                    // Test download endpoint
                    testDownloadRat(response.token, 2);
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
        console.log(`Response status: ${res.statusCode}`);
        console.log(`Content-Type: ${res.headers['content-type']}`);
        console.log(`Content-Disposition: ${res.headers['content-disposition']}`);
        console.log(`Content-Length: ${res.headers['content-length']} bytes`);
        
        if (res.statusCode === 200) {
            console.log('✓ Download successful!');
            
            // Save the file
            const fileStream = fs.createWriteStream(`test_download_rat_user_${userId}.exe`);
            
            res.on('data', (chunk) => {
                fileStream.write(chunk);
            });
            
            res.on('end', () => {
                fileStream.end();
                console.log(`✓ RAT file saved as: test_download_rat_user_${userId}.exe`);
                
                // Verify file size
                const stats = fs.statSync(`test_download_rat_user_${userId}.exe`);
                console.log(`✓ Downloaded file size: ${stats.size} bytes`);
                
                console.log('\n=== Complete RAT generation and download flow tested successfully! ===');
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
testDownloadEndpoint();