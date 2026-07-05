const express = require('express');
const { redis, mysqlPool: pool, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.mysql;
const GEO_KEY = 'stores:geo';

// Automatically create table on startup
async function initDb() {
    try {
        const connection = await pool.getConnection();
        await connection.query(`
            CREATE TABLE IF NOT EXISTS stores (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                longitude DECIMAL(9,6) NOT NULL,
                latitude DECIMAL(8,6) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        connection.release();
        console.log('Database initialized successfully: "stores" table is ready.');
    } catch (err) {
        console.error('Failed to initialize database table:', err.message);
    }
}

// 1. ADD STORE - Write-Through Strategy (saves in MySQL and adds to Redis GEO)
// POST http://localhost:3003/stores
app.post('/stores', async (req, res) => {
    const { name, longitude, latitude } = req.body;
    
    if (!name || longitude === undefined || latitude === undefined) {
        return res.status(400).json({ error: 'name, longitude, and latitude are required' });
    }
    
    try {
        const lng = parseFloat(longitude);
        const lat = parseFloat(latitude);
        
        // Save in MySQL
        const [result] = await pool.query(
            'INSERT INTO stores (name, longitude, latitude) VALUES (?, ?, ?)',
            [name, lng, lat]
        );
        
        // Add to Redis Geospatial index (Write-Through)
        const memberId = `store:${result.insertId}`;
        await redis.geoadd(GEO_KEY, lng, lat, memberId);
        
        // Set TTL on GEO key (e.g. 2 hours)
        await redis.expire(GEO_KEY, 7200);
        console.log(`[Write-Through Cache] Added store ${memberId} ("${name}") to GEO Cache`);
        
        return res.status(201).json({
            message: 'Store created successfully',
            store: { id: result.insertId, name, longitude: lng, latitude: lat }
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. SEARCH NEARBY STORES - Cache-Aside Caching Strategy (using Redis GEOSEARCH)
// GET http://localhost:3003/stores/nearby?lon=-122.41&lat=37.77&radius=5
app.get('/stores/nearby', async (req, res) => {
    const { lon, lat, radius } = req.query;
    
    if (lon === undefined || lat === undefined || radius === undefined) {
        return res.status(400).json({ error: 'Query parameters "lon", "lat", and "radius" (in km) are required' });
    }
    
    try {
        const lngQuery = parseFloat(lon);
        const latQuery = parseFloat(lat);
        const radQuery = parseFloat(radius);
        
        // Step 1: Check if GEO index exists in Redis
        const exists = await redis.exists(GEO_KEY);
        
        if (exists === 1) {
            console.log(`[Cache Hit] Serving nearby stores from Redis GEO Index`);
            const results = await redis.geosearch(
                GEO_KEY,
                'FROMLONLAT', lngQuery, latQuery,
                'BYRADIUS', radQuery, 'km',
                'ASC',
                'WITHDIST',
                'WITHCOORD'
            );
            
            const stores = results.map(([member, dist, [lng, lat]]) => ({
                storeId: member.split(':')[1],
                distanceKm: parseFloat(dist),
                coordinates: { longitude: parseFloat(lng), latitude: parseFloat(lat) }
            }));
            
            return res.json({ source: 'Redis GEO Cache', count: stores.length, stores });
        }
        
        // Step 2: Cache Miss - Query MySQL
        console.log(`[Cache Miss] Fetching stores from MySQL...`);
        const [rows] = await pool.query('SELECT id, name, longitude, latitude FROM stores');
        
        // Step 3: Populate Redis GEO Cache
        if (rows.length > 0) {
            const pipeline = redis.pipeline();
            rows.forEach(r => {
                pipeline.geoadd(GEO_KEY, parseFloat(r.longitude), parseFloat(r.latitude), `store:${r.id}`);
            });
            pipeline.expire(GEO_KEY, 3600); // 1 hour TTL
            await pipeline.exec();
            console.log(`[Cache Populated] Restored ${rows.length} store locations into Redis GEO Cache`);
        }
        
        // Run query again on populated cache to guarantee same sorting/radius logic
        const results = await redis.geosearch(
            GEO_KEY,
            'FROMLONLAT', lngQuery, latQuery,
            'BYRADIUS', radQuery, 'km',
            'ASC',
            'WITHDIST',
            'WITHCOORD'
        );
        
        const stores = results.map(([member, dist, [lng, lat]]) => ({
            storeId: member.split(':')[1],
            distanceKm: parseFloat(dist),
            coordinates: { longitude: parseFloat(lng), latitude: parseFloat(lat) }
        }));
        
        return res.json({ source: 'MySQL Database (Restored Cache)', count: stores.length, stores });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, async () => {
    await initDb();
    console.log(`MySQL Stores Proximity API running on http://localhost:${PORT}`);
});
