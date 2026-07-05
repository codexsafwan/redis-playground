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

// 1. CREATE USER
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
        
        const newUser = { id: result.insertId, name, email, role: role || 'user' };
        
        return res.status(201).json({ message: 'User created in MySQL', user: newUser });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Email already exists' });
        }
        return res.status(500).json({ error: err.message });
    }
});

// 2. GET USER - Cache-Aside Caching Strategy (using Redis Hash)
// GET http://localhost:3003/users/:id
app.get('/users/:id', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `db:user:hash:${id}`;
    
    try {
        // Step 1: Check Redis Hash cache
        const cachedUser = await redis.hgetall(cacheKey);
        
        if (Object.keys(cachedUser).length > 0) {
            console.log(`[Cache Hit] Serving user ${id} from Redis Hash Cache`);
            return res.json({
                source: 'Redis Hash Cache',
                user: {
                    id: parseInt(cachedUser.id, 10),
                    name: cachedUser.name,
                    email: cachedUser.email,
                    role: cachedUser.role
                }
            });
        }
        
        // Step 2: Cache Miss - Query MySQL
        console.log(`[Cache Miss] Querying user ${id} from MySQL...`);
        const [rows] = await pool.query('SELECT id, name, email, role FROM users WHERE id = ?', [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const user = rows[0];
        
        // Step 3: Populate Redis Hash with 60 seconds expiration
        await redis.hset(cacheKey, {
            id: user.id.toString(),
            name: user.name,
            email: user.email,
            role: user.role
        });
        await redis.expire(cacheKey, 60);
        console.log(`[Cache Populated] Saved user ${id} in Redis Hash key "${cacheKey}"`);
        
        return res.json({ source: 'MySQL Database', user });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. UPDATE USER - Invalidate Hash Cache
// PUT http://localhost:3003/users/:id
app.put('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { name, email, role } = req.body;
    const cacheKey = `db:user:hash:${id}`;
    
    try {
        const [result] = await pool.query(
            'UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), role = COALESCE(?, role) WHERE id = ?',
            [name, email, role, id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Invalidate Redis Hash Cache
        await redis.del(cacheKey);
        console.log(`[Cache Invalidation] Deleted Hash key ${cacheKey} due to user update`);
        
        return res.json({ message: `User ${id} updated. Cache invalidated.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 4. DELETE USER - Invalidate Hash Cache
// DELETE http://localhost:3003/users/:id
app.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `db:user:hash:${id}`;
    
    try {
        const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Delete from Redis Hash Cache
        await redis.del(cacheKey);
        console.log(`[Cache Invalidation] Deleted Hash key ${cacheKey} due to user deletion`);
        
        return res.json({ message: `User ${id} deleted. Cache cleared.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, async () => {
    await initDb();
    console.log(`MySQL Hash Cache API running on http://localhost:${PORT}`);
});
