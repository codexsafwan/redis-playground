const express = require('express');
const { redis, mysqlPool: pool, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.mysql;
const AUDIT_KEY = 'logs:audit';

// Automatically create table on startup
async function initDb() {
    try {
        const connection = await pool.getConnection();
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        connection.release();
        console.log('Database initialized successfully: "users" table is ready.');
    } catch (err) {
        console.error('Failed to initialize database table:', err.message);
    }
}

// Helper to push audit logs to Redis List and keep it capped to 10 entries
async function addAuditLog(action, details) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ACTION: ${action} | DETAILS: ${details}`;
    
    try {
        // Push onto the left of the audit list
        await redis.lpush(AUDIT_KEY, logEntry);
        // Cap the list to hold only the 10 most recent logs (indices 0 to 9)
        await redis.ltrim(AUDIT_KEY, 0, 9);
        console.log(`[Audit Logged] ${logEntry}`);
    } catch (err) {
        console.error('Failed to log audit event in Redis:', err.message);
    }
}

// 1. CREATE USER - In addition to database insert, log the audit event
// POST http://localhost:3003/users
app.post('/users', async (req, res) => {
    const { name, email, role } = req.body;
    
    if (!name || !email) {
        return res.status(400).json({ error: 'Name and email are required' });
    }
    
    try {
        const [result] = await pool.query(
            'INSERT INTO users (name, email, role) VALUES (?, ?, ?)',
            [name, email, role || 'user']
        );
        
        const newUser = {
            id: result.insertId,
            name,
            email,
            role: role || 'user'
        };
        
        // Log event to Redis List
        await addAuditLog('CREATE_USER', `ID: ${newUser.id}, Name: ${newUser.name}, Email: ${newUser.email}`);
        
        return res.status(201).json({
            message: 'User created in MySQL and audit event logged',
            user: newUser
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Email already exists' });
        }
        return res.status(500).json({ error: err.message });
    }
});

// 2. UPDATE USER - In addition to DB update, log the audit event
// PUT http://localhost:3003/users/:id
app.put('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { name, email, role } = req.body;
    
    try {
        const [result] = await pool.query(
            'UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), role = COALESCE(?, role) WHERE id = ?',
            [name, email, role, id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Log event to Redis List
        const updatedFields = [];
        if (name) updatedFields.push(`Name->${name}`);
        if (email) updatedFields.push(`Email->${email}`);
        if (role) updatedFields.push(`Role->${role}`);
        
        await addAuditLog('UPDATE_USER', `ID: ${id}, Fields Changed: [${updatedFields.join(', ')}]`);
        
        return res.json({ message: `User ${id} updated in database. Audit event logged.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. DELETE USER - In addition to DB delete, log the audit event
// DELETE http://localhost:3003/users/:id
app.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Log event to Redis List
        await addAuditLog('DELETE_USER', `ID: ${id}`);
        
        return res.json({ message: `User ${id} deleted. Audit event logged.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 4. GET AUDIT LOGS - Retrieves the latest 10 audit logs from the Redis List
// GET http://localhost:3003/audit-logs
app.get('/audit-logs', async (req, res) => {
    try {
        const logs = await redis.lrange(AUDIT_KEY, 0, 9);
        return res.json({
            message: 'Recent database operations logs (Latest 10)',
            count: logs.length,
            logs
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Start application
app.listen(PORT, async () => {
    await initDb();
    console.log(`MySQL Audit Logger API running on http://localhost:${PORT}`);
});
