const express = require('express');
const { redis, mysqlPool: pool, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.mysql;

// Automatically create table on startup
async function initDb() {
    try {
        const connection = await pool.getConnection();
        await connection.query(`
            CREATE TABLE IF NOT EXISTS user_permissions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                permission VARCHAR(100) NOT NULL,
                UNIQUE KEY unique_user_perm (user_id, permission)
            )
        `);
        connection.release();
        console.log('Database initialized successfully: "user_permissions" table is ready.');
    } catch (err) {
        console.error('Failed to initialize database table:', err.message);
    }
}

// 1. GRANT PERMISSION - Write to DB & Invalidate Cache
// POST http://localhost:3003/permissions
app.post('/permissions', async (req, res) => {
    const { userId, permission } = req.body;
    
    if (!userId || !permission) {
        return res.status(400).json({ error: 'userId and permission are required' });
    }
    
    const cacheKey = `user:permissions:${userId}`;
    
    try {
        await pool.query(
            'INSERT INTO user_permissions (user_id, permission) VALUES (?, ?) ON DUPLICATE KEY UPDATE permission=permission',
            [userId, permission]
        );
        
        // Invalidate Redis Set Cache
        await redis.del(cacheKey);
        console.log(`[Cache Invalidation] Deleted key ${cacheKey} due to permission update`);
        
        return res.status(201).json({ message: `Permission "${permission}" granted to user ${userId}. Cache invalidated.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. CHECK & GET USER PERMISSIONS - Cache-Aside Caching Strategy (using Redis Set)
// GET http://localhost:3003/users/:id/permissions
app.get('/users/:id/permissions', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `user:permissions:${id}`;
    
    try {
        // Step 1: Check if permissions cache set exists (we check if size/exists > 0)
        const exists = await redis.exists(cacheKey);
        
        if (exists === 1) {
            console.log(`[Cache Hit] Serving permissions for user ${id} from Redis Set Cache`);
            const permissions = await redis.smembers(cacheKey);
            return res.json({
                source: 'Redis Cache',
                userId: id,
                permissions
            });
        }
        
        // Step 2: Cache Miss - Query MySQL
        console.log(`[Cache Miss] Querying permissions for user ${id} from MySQL...`);
        const [rows] = await pool.query('SELECT permission FROM user_permissions WHERE user_id = ?', [id]);
        
        const permissions = rows.map(r => r.permission);
        
        // Step 3: Populate Redis Set with 60 seconds expiration
        if (permissions.length > 0) {
            await redis.sadd(cacheKey, ...permissions);
            await redis.expire(cacheKey, 60);
        } else {
            // If user has no permissions, we can add a placeholder to prevent cache penetration
            await redis.sadd(cacheKey, 'NONE');
            await redis.expire(cacheKey, 30); // shorter expire for negative cache
        }
        
        return res.json({
            source: 'MySQL Database',
            userId: id,
            permissions: permissions.length > 0 ? permissions : []
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. REVOKE PERMISSION - Delete from DB & Invalidate Cache
// DELETE http://localhost:3003/permissions
app.delete('/permissions', async (req, res) => {
    const { userId, permission } = req.body;
    
    if (!userId || !permission) {
        return res.status(400).json({ error: 'userId and permission are required' });
    }
    
    const cacheKey = `user:permissions:${userId}`;
    
    try {
        const [result] = await pool.query(
            'DELETE FROM user_permissions WHERE user_id = ? AND permission = ?',
            [userId, permission]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Permission mapping not found' });
        }
        
        // Invalidate Redis Set Cache
        await redis.del(cacheKey);
        console.log(`[Cache Invalidation] Deleted key ${cacheKey} due to permission revocation`);
        
        return res.json({ message: `Permission "${permission}" revoked from user ${userId}. Cache cleared.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, async () => {
    await initDb();
    console.log(`MySQL Permissions Cache API running on http://localhost:${PORT}`);
});
