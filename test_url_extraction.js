const C2Database = require('./bridge/database');
const db = new C2Database(':memory:');

// Test URL extraction regex - captures domain only (no path)
const urlRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+(?:\/[^\s]*)?)/gi;

const testCases = [
    { title: 'Test - Google Chrome', expected: null },
    { title: 'GitHub - Google Chrome', expected: null },  // No dot = not a URL
    { title: 'facebook.com - Google Chrome', expected: 'facebook.com' },
    { title: 'https://www.youtube.com/watch?v=123 - Google Chrome', expected: 'youtube.com' },
    { title: 'stackoverflow.com/questions/123 - Google Chrome', expected: 'stackoverflow.com' },
    { title: 'localhost:3000 - Google Chrome', expected: null },  // No TLD
    { title: '192.168.1.1/admin - Google Chrome', expected: null },  // IP, not domain
    { title: 'reddit.com/r/programming - Google Chrome', expected: 'reddit.com' },
    { title: 'New Tab - Google Chrome', expected: null },
    { title: 'Settings - Google Chrome', expected: null },
    { title: 'chrome://extensions - Google Chrome', expected: null },
    { title: 'about:blank - Google Chrome', expected: null },
    { title: 'Mozilla Firefox', expected: null },
    { title: 'Inbox (3) - admin@gmail.com - Gmail - Google Chrome', expected: 'gmail.com' },
    { title: 'docs.google.com/document/d/abc123 - Google Chrome', expected: 'docs.google.com' },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
    const match = urlRegex.exec(tc.title);
    urlRegex.lastIndex = 0;
    
    let extracted = null;
    if (match) {
        const full = match[0].toLowerCase();
        // Skip chrome://, about:, localhost-only, new tab, settings
        if (full.startsWith('chrome://') || full.startsWith('about:') || full === 'localhost' || full.startsWith('localhost:')) {
            extracted = null;
        } else {
            // Extract just the domain (hostname) from the match
            // match[1] has the domain, but may include path after the TLD
            const domainPart = match[1].toLowerCase();
            // Remove any path after the domain
            const pathIdx = domainPart.indexOf('/');
            extracted = pathIdx > 0 ? domainPart.substring(0, pathIdx) : domainPart;
        }
    }
    
    const status = extracted === tc.expected ? 'PASS' : 'FAIL';
    if (status === 'PASS') passed++; else failed++;
    console.log(status + ': "' + tc.title + '" => ' + extracted + ' (expected: ' + tc.expected + ')');
}

console.log('\nResults: ' + passed + '/' + (passed+failed) + ' passed');
