const express = require('express');
const { redis, mysqlPool: pool, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.mysql;
const LEADERBOARD_KEY = 'scores:leaderboard';

// Automatically create table on startup
async function initDb() {
    try {
        const connection = await pool.getConnection();
        await connection.query(`
            CREATE TABLE IF NOT EXISTS player_scores (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) NOT NULL UNIQUE,
                score INT DEFAULT 0
            )
        `);
        connection.release();
        console.log('Database initialized successfully: "player_scores" table is ready.');
    } catch (err) {
        console.error('Failed to initialize database table:', err.message);
    }
}

// 1. ADD / UPDATE SCORE - Write-Through Strategy (updates both DB and Redis immediately)
// POST http://localhost:3003/scores
app.post('/scores', async (req, res) => {
    const { username, score } = req.body;
    
    if (!username || score === undefined) {
        return res.status(400).json({ error: 'username and score are required' });
    }
    
    try {
        // Update or insert score in MySQL
        await pool.query(
            'INSERT INTO player_scores (username, score) VALUES (?, ?) ON DUPLICATE KEY UPDATE score = ?',
            [username, score, score]
        );
        
        // Update Redis Sorted Set Cache Immediately (Write-Through)
        await redis.zadd(LEADERBOARD_KEY, score, username);
        console.log(`[Write-Through Cache] Updated score for "${username}" to ${score} in Sorted Set`);
        
        return res.json({ message: `Score for "${username}" updated to ${score} in database and cache` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. GET LEADERBOARD - Cache-Aside Caching Strategy (using Redis Sorted Set)
// GET http://localhost:3003/leaderboard
app.get('/leaderboard', async (req, res) => {
    try {
        // Step 1: Check if leaderboard sorted set exists
        const exists = await redis.exists(LEADERBOARD_KEY);
        
        if (exists === 1) {
            console.log(`[Cache Hit] Serving leaderboard from Redis Sorted Set`);
            const topScores = await redis.zrevrange(LEADERBOARD_KEY, 0, 9, 'WITHSCORES');
            
            const results = [];
            for (let i = 0; i < topScores.length; i += 2) {
                results.push({ rank: (i/2) + 1, username: topScores[i], score: parseInt(topScores[i + 1], 10) });
            }
            return res.json({ source: 'Redis Cache', count: results.length, leaderboard: results });
        }
        
        // Step 2: Cache Miss - Query MySQL
        console.log(`[Cache Miss] Fetching leaderboard from MySQL...`);
        const [rows] = await pool.query('SELECT username, score FROM player_scores ORDER BY score DESC LIMIT 100');
        
        // Step 3: Populate Redis Sorted Set cache with 120s TTL
        if (rows.length > 0) {
            const pipeline = redis.pipeline();
            rows.forEach(r => pipeline.zadd(LEADERBOARD_KEY, r.score, r.username));
            pipeline.expire(LEADERBOARD_KEY, 120);
            await pipeline.exec();
            console.log(`[Cache Populated] Cached ${rows.length} player scores in Redis Sorted Set`);
        }
        
        const leaderboard = rows.slice(0, 10).map((r, i) => ({ rank: i + 1, username: r.username, score: r.score }));
        return res.json({ source: 'MySQL Database', count: leaderboard.length, leaderboard });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. DELETE PLAYER SCORE - Delete from DB & Cache
// DELETE http://localhost:3003/scores/:username
app.delete('/scores/:username', async (req, res) => {
    const { username } = req.params;
    
    try {
        const [result] = await pool.query('DELETE FROM player_scores WHERE username = ?', [username]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Player not found' });
        }
        
        // Remove from Redis Sorted Set Cache
        await redis.zrem(LEADERBOARD_KEY, username);
        console.log(`[Cache Sync] Removed "${username}" from Sorted Set Cache`);
        
        return res.json({ message: `Player "${username}" deleted. Cache updated.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, async () => {
    await initDb();
    console.log(`MySQL Leaderboard Cache API running on http://localhost:${PORT}`);
});
