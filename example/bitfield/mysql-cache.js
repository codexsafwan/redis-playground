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
            CREATE TABLE IF NOT EXISTS player_stats (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL UNIQUE,
                level INT DEFAULT 1,
                high_score INT DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        connection.release();
        console.log('Database initialized successfully: "player_stats" table is ready.');
    } catch (err) {
        console.error('Failed to initialize database table:', err.message);
    }
}

// 1. UPDATE STATS - Write-Through Strategy (saves in MySQL and updates Bitfield with Overflow SAT)
// POST http://localhost:3003/users/:id/stats
app.post('/users/:id/stats', async (req, res) => {
    const { id } = req.params;
    const { level, highScore } = req.body;
    
    if (level === undefined || highScore === undefined) {
        return res.status(400).json({ error: 'level and highScore are required' });
    }
    
    const userIdInt = parseInt(id, 10);
    const lvlVal = parseInt(level, 10);
    const scoreVal = parseInt(highScore, 10);
    const cacheKey = `user:stats:bitfield:${userIdInt}`;
    
    try {
        // Update database
        await pool.query(
            'INSERT INTO player_stats (user_id, level, high_score) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE level = ?, high_score = ?',
            [userIdInt, lvlVal, scoreVal, lvlVal, scoreVal]
        );
        
        // Update Redis Bitfield with Saturation Overflow limit to prevent integer wraps
        // Level: u8 at bit 0 (range 0-255)
        // High Score: u32 at bit 8 (range 0-4294967295)
        await redis.bitfield(
            cacheKey,
            'OVERFLOW', 'SAT',
            'SET', 'u8', 0, lvlVal,
            'SET', 'u32', 8, scoreVal
        );
        await redis.expire(cacheKey, 3600); // 1 hour TTL
        
        console.log(`[Write-Through Cache] Updated Bitfield stats for user ${userIdInt}`);
        return res.json({ message: `Stats for user ${userIdInt} updated in DB and Bitfield` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. GET STATS - Cache-Aside Caching Strategy (using Redis Bitfield GET)
// GET http://localhost:3003/users/:id/stats
app.get('/users/:id/stats', async (req, res) => {
    const { id } = req.params;
    const userIdInt = parseInt(id, 10);
    const cacheKey = `user:stats:bitfield:${userIdInt}`;
    
    try {
        // Step 1: Check if Bitfield exists in Redis
        const exists = await redis.exists(cacheKey);
        
        if (exists === 1) {
            console.log(`[Cache Hit] Serving stats for user ${id} from Redis Bitfield`);
            const results = await redis.bitfield(
                cacheKey,
                'GET', 'u8', 0,
                'GET', 'u32', 8
            );
            
            const [level, highScore] = results;
            return res.json({
                source: 'Redis Bitfield Cache',
                userId: userIdInt,
                stats: { level, highScore }
            });
        }
        
        // Step 2: Cache Miss - Query MySQL
        console.log(`[Cache Miss] Querying stats for user ${id} from MySQL...`);
        const [rows] = await pool.query(
            'SELECT level, high_score FROM player_stats WHERE user_id = ?',
            [userIdInt]
        );
        
        let stats = { level: 1, highScore: 0 };
        if (rows.length > 0) {
            stats = { level: rows[0].level, highScore: rows[0].high_score };
        }
        
        // Step 3: Populate Redis Bitfield Cache
        await redis.bitfield(
            cacheKey,
            'SET', 'u8', 0, stats.level,
            'SET', 'u32', 8, stats.highScore
        );
        await redis.expire(cacheKey, 120); // 2 minutes TTL
        console.log(`[Cache Populated] Restored player stats into Bitfield cache key ${cacheKey}`);
        
        return res.json({
            source: 'MySQL Database',
            userId: userIdInt,
            stats
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, async () => {
    await initDb();
    console.log(`MySQL stats Bitfields API running on http://localhost:${PORT}`);
});
