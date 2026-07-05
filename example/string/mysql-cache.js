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

// 1. CREATE USER - Write-Aside/Cache-Aside Strategy
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
        
        return res.status(201).json({
            message: 'User created in MySQL',
            user: newUser
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Email already exists' });
        }
        return res.status(500).json({ error: err.message });
    }
});

// 2. GET USER BY ID - Cache-Aside Caching Strategy
// GET http://localhost:3003/users/:id
app.get('/users/:id', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `db:user:${id}`;
    
    try {
        // Step 1: Query Redis cache
        const cachedUser = await redis.get(cacheKey);
        
        if (cachedUser) {
            console.log(`[Cache Hit] Serving user ${id} from Redis String Cache`);
            return res.json({
                source: 'Redis Cache',
                user: JSON.parse(cachedUser)
            });
        }
        
        // Step 2: Cache Miss - Query MySQL
        console.log(`[Cache Miss] Querying user ${id} from MySQL...`);
        const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found in database' });
        }
        
        const user = rows[0];
        
        // Step 3: Populate Redis cache with 60 seconds expiration
        await redis.set(cacheKey, JSON.stringify(user), 'EX', 60);
        
        return res.json({
            source: 'MySQL Database',
            user
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. UPDATE USER - Cache Invalidation Strategy
// PUT http://localhost:3003/users/:id
app.put('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { name, email, role } = req.body;
    const cacheKey = `db:user:${id}`;
    
    try {
        // Step 1: Update database
        const [result] = await pool.query(
            'UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), role = COALESCE(?, role) WHERE id = ?',
            [name, email, role, id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Step 2: Invalidate Cache (Delete the key from Redis)
        // This ensures the next GET request fetches updated data from MySQL
        await redis.del(cacheKey);
        console.log(`[Cache Invalidation] Deleted cache key ${cacheKey} due to update`);
        
        return res.json({ message: `User ${id} updated in database. Cache invalidated.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 4. DELETE USER - Cache Invalidation Strategy
// DELETE http://localhost:3003/users/:id
app.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `db:user:${id}`;
    
    try {
        // Step 1: Delete from MySQL
        const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Step 2: Delete from Redis Cache
        await redis.del(cacheKey);
        console.log(`[Cache Invalidation] Deleted cache key ${cacheKey} due to deletion`);
        
        return res.json({ message: `User ${id} deleted from database. Cache cleared.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Start application
app.listen(PORT, async () => {
    await initDb();
    console.log(`MySQL Caching API running on http://localhost:${PORT}`);
});
