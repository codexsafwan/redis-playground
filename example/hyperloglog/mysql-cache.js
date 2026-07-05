const express = require('express');
const { redis, mysqlPool: pool, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.mysql;
const VISITOR_HLL_KEY = 'visitor:hll:unique';

// Automatically create table on startup
async function initDb() {
    try {
        const connection = await pool.getConnection();
        await connection.query(`
            CREATE TABLE IF NOT EXISTS page_visits (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ip_address VARCHAR(45) NOT NULL,
                visit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        connection.release();
        console.log('Database initialized successfully: "page_visits" table is ready.');
    } catch (err) {
        console.error('Failed to initialize database table:', err.message);
    }
}

// 1. LOG VISIT - Write-Through Strategy (logs in DB and adds to HyperLogLog)
// POST http://localhost:3003/visit
app.post('/visit', async (req, res) => {
    const { ipAddress } = req.body;
    
    if (!ipAddress) {
        return res.status(400).json({ error: 'ipAddress is required' });
    }
    
    try {
        // Log in DB
        await pool.query('INSERT INTO page_visits (ip_address) VALUES (?)', [ipAddress]);
        
        // Add to Redis HyperLogLog immediately (Write-Through)
        await redis.pfadd(VISITOR_HLL_KEY, ipAddress);
        
        // Keep HLL active for 24 hours
        await redis.expire(VISITOR_HLL_KEY, 86400);
        console.log(`[Write-Through Cache] Added IP ${ipAddress} to HyperLogLog`);
        
        return res.json({ message: 'Visit logged successfully' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. GET UNIQUE VISITOR COUNT - Cache-Aside Caching Strategy (using Redis PFCOUNT)
// GET http://localhost:3003/visitors/count
app.get('/visitors/count', async (req, res) => {
    try {
        // Step 1: Check if HyperLogLog cache exists in Redis
        const exists = await redis.exists(VISITOR_HLL_KEY);
        
        if (exists === 1) {
            console.log(`[Cache Hit] Serving unique visitor count from Redis HyperLogLog`);
            const count = await redis.pfcount(VISITOR_HLL_KEY);
            return res.json({
                source: 'Redis HyperLogLog Cache',
                estimatedUniqueCount: count,
                precision: 'Approximate (~0.81% error margin)'
            });
        }
        
        // Step 2: Cache Miss - Query MySQL for unique IPs
        console.log(`[Cache Miss] Querying unique visitors from MySQL...`);
        const [rows] = await pool.query('SELECT DISTINCT ip_address FROM page_visits');
        
        const ipAddresses = rows.map(r => r.ip_address);
        
        // Step 3: Populate Redis HyperLogLog Cache with 600s TTL (10 minutes)
        if (ipAddresses.length > 0) {
            const pipeline = redis.pipeline();
            // Bulk push to HLL
            pipeline.pfadd(VISITOR_HLL_KEY, ...ipAddresses);
            pipeline.expire(VISITOR_HLL_KEY, 600);
            await pipeline.exec();
            console.log(`[Cache Populated] Restored ${ipAddresses.length} unique IPs into HyperLogLog Cache`);
        }
        
        return res.json({
            source: 'MySQL Database',
            estimatedUniqueCount: ipAddresses.length,
            precision: 'Exact'
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, async () => {
    await initDb();
    console.log(`MySQL Visitors HLL API running on http://localhost:${PORT}`);
});
