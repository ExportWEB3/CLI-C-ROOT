const bcrypt = require('bcrypt');
const crypto = require('crypto');

class AuthManager {
    constructor(db) {
        this.db = db;
        this.jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
        this.tokenExpiry = '24h';
    }

    // Hash password
    async hashPassword(password) {
        const saltRounds = 10;
        return await bcrypt.hash(password, saltRounds);
    }

    // Verify password
    async verifyPassword(password, hash) {
        return await bcrypt.compare(password, hash);
    }

    // Create JWT token (simplified - using simple signature for now)
    createToken(userId, username, role) {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
        const payload = Buffer.from(JSON.stringify({
            sub: userId,
            username: username,
            role: role,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
        })).toString('base64');
        
        const signature = crypto.createHmac('sha256', this.jwtSecret)
            .update(`${header}.${payload}`)
            .digest('base64');
        
        return `${header}.${payload}.${signature}`;
    }

    // Verify JWT token
    verifyToken(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return null;
            
            const [header, payload, signature] = parts;
            
            // Verify signature
            const expectedSignature = crypto.createHmac('sha256', this.jwtSecret)
                .update(`${header}.${payload}`)
                .digest('base64');
            
            if (signature !== expectedSignature) return null;
            
            // Parse payload
            const payloadData = JSON.parse(Buffer.from(payload, 'base64').toString());
            
            // Check expiration
            if (payloadData.exp && payloadData.exp < Math.floor(Date.now() / 1000)) {
                return null;
            }
            
            return payloadData;
        } catch (error) {
            console.error('Token verification error:', error);
            return null;
        }
    }

    // Register new user
    async register(username, password, role = 'user') {
        // Check if user exists
        const existingUser = this.db.getUserByUsername(username);
        if (existingUser) {
            return { success: false, error: 'Username already exists' };
        }

        // Hash password
        const passwordHash = await this.hashPassword(password);
        
        // Create user
        const result = this.db.createUser(username, passwordHash, role);
        
        if (result.success) {
            // Create token
            const token = this.createToken(result.userId, username, role);
            return { 
                success: true, 
                userId: result.userId, 
                username, 
                role, 
                token 
            };
        }
        
        return result;
    }

    // Login user
    async login(username, password) {
        // Get user
        const user = this.db.getUserByUsername(username);
        if (!user) {
            return { success: false, error: 'Invalid username or password' };
        }

        // Verify password
        const passwordValid = await this.verifyPassword(password, user.password_hash);
        if (!passwordValid) {
            return { success: false, error: 'Invalid username or password' };
        }

        // Check if user is active
        if (user.is_active !== 1) {
            return { success: false, error: 'Account is disabled' };
        }

        // Update last login
        this.db.updateUserLastLogin(user.id);

        // Create token
        const token = this.createToken(user.id, user.username, user.role);
        
        return { 
            success: true, 
            userId: user.id, 
            username: user.username, 
            role: user.role, 
            token 
        };
    }

    // Verify token and get user
    authenticate(token) {
        const payload = this.verifyToken(token);
        if (!payload) return null;
        
        return {
            userId: payload.sub,
            username: payload.username,
            role: payload.role
        };
    }

    // Middleware for WebSocket authentication
    wsAuthMiddleware(ws, req) {
        // Extract token: 1) Cookie header, 2) query param, 3) Authorization header
        let token = null;

        // Try HttpOnly cookie first
        const cookieHeader = req.headers['cookie'] || '';
        const cookieMatch = cookieHeader.split(';').find(c => c.trim().startsWith('auth_token='));
        if (cookieMatch) {
            token = decodeURIComponent(cookieMatch.split('=').slice(1).join('=').trim());
        }

        // Fallback: query param (dev / non-cookie clients)
        if (!token) {
            const url = new URL(req.url, `http://${req.headers.host}`);
            token = url.searchParams.get('token');
        }

        // Fallback: Authorization header
        if (!token) {
            token = req.headers['authorization']?.replace('Bearer ', '') || null;
        }
        
        if (!token) {
            return { authenticated: false, error: 'No token provided' };
        }
        
        const user = this.authenticate(token);
        if (!user) {
            return { authenticated: false, error: 'Invalid token' };
        }
        
        return { authenticated: true, user };
    }

    // Create default admin user if none exists
    async createDefaultAdmin() {
        const users = this.db.getAllUsers();
        if (users.length === 0) {
            const defaultPassword = 'admin123'; // Change this in production!
            const result = await this.register('admin', defaultPassword, 'admin');
            if (result.success) {
                console.log('Default admin user created: admin / admin123');
                return true;
            }
        }
        return false;
    }
}

module.exports = AuthManager;