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
            CREATE TABLE IF NOT EXISTS user_activity (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                activity_date DATE NOT NULL,
                UNIQUE KEY unique_user_day (user_id, activity_date)
            )
        `);
        connection.release();
        console.log('Database initialized successfully: "user_activity" table is ready.');
    } catch (err) {
        console.error('Failed to initialize database table:', err.message);
    }
}

// 1. LOG ACTIVITY - Write-Through Strategy (logs in DB and sets bit in Redis)
// POST http://localhost:3003/users/:id/active
app.post('/users/:id/active', async (req, res) => {
    const { id } = req.params;
    const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
    const cacheKey = `active:users:${today}`;
    
    try {
        const userIdInt = parseInt(id, 10);
        
        // Log in MySQL
        await pool.query(
            'INSERT INTO user_activity (user_id, activity_date) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id',
            [userIdInt, today]
        );
        
        // Update Redis Bitmap key
        await redis.setbit(cacheKey, userIdInt, 1);
        // Expire bitmap after 7 days (604800 seconds)
        await redis.expire(cacheKey, 604800);
        
        console.log(`[Write-Through Cache] Marked user ${userIdInt} active on ${today} in Bitmap`);
        return res.json({ message: `Activity logged in DB and Bitmap for user ${userIdInt} on ${today}` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. GET ACTIVE COUNT - Cache-Aside Caching Strategy (using Redis BITCOUNT)
// GET http://localhost:3003/active-count/:date
app.get('/active-count/:date', async (req, res) => {
    const { date } = req.params; // Format: YYYY-MM-DD
    const cacheKey = `active:users:${date}`;
    
    try {
        // Step 1: Check if Bitmap exists in Redis
        const exists = await redis.exists(cacheKey);
        
        if (exists === 1) {
            console.log(`[Cache Hit] Serving active count for ${date} from Redis Bitmap`);
            const count = await redis.bitcount(cacheKey);
            return res.json({
                source: 'Redis Bitmap Cache',
                date,
                activeCount: count
            });
        }
        
        // Step 2: Cache Miss - Query MySQL
        console.log(`[Cache Miss] Querying active count for ${date} from MySQL...`);
        const [rows] = await pool.query(
            'SELECT user_id FROM user_activity WHERE activity_date = ?',
            [date]
        );
        
        // Step 3: Populate Redis Bitmap Cache
        if (rows.length > 0) {
            // Set bits for active users in pipeline
            const pipeline = redis.pipeline();
            rows.forEach(r => pipeline.setbit(cacheKey, r.user_id, 1));
            // Keep active key cached for 24 hours (86400 seconds)
            pipeline.expire(cacheKey, 86400);
            await pipeline.exec();
            console.log(`[Cache Populated] Restored bitmap cache for date ${date}`);
        } else {
            // If no activity, create empty string cache with short TTL to prevent cache penetration
            await redis.set(cacheKey, '', 'EX', 300);
        }
        
        return res.json({
            source: 'MySQL Database',
            date,
            activeCount: rows.length
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, async () => {
    await initDb();
    console.log(`MySQL Active Users Bitmap API running on http://localhost:${PORT}`);
});
