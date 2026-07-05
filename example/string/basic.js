const express = require('express');
const { redis, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.basic;

// 1. SET Endpoint - Stores raw key-value string
// POST http://localhost:3001/set
app.post('/set', async (req, res) => {
    const { key, value, ttl } = req.body;
    
    if (!key || !value) {
        return res.status(400).json({ error: 'Key and Value are required' });
    }
    
    try {
        if (ttl) {
            // SET with Expiration (TTL in seconds)
            await redis.set(key, value, 'EX', parseInt(ttl, 10));
            return res.json({ message: `Successfully set key "${key}" with TTL of ${ttl}s` });
        } else {
            // Standard SET
            await redis.set(key, value);
            return res.json({ message: `Successfully set key "${key}"` });
        }
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. GET Endpoint - Retrieves value of a string key
// GET http://localhost:3001/get/my-key
app.get('/get/:key', async (req, res) => {
    const { key } = req.params;
    
    try {
        const value = await redis.get(key);
        if (value === null) {
            return res.status(404).json({ error: `Key "${key}" not found` });
        }
        return res.json({ key, value });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. INCR Endpoint - Atomically increments numeric values
// POST http://localhost:3001/incr/views-count
app.post('/incr/:key', async (req, res) => {
    const { key } = req.params;
    
    try {
        const newValue = await redis.incr(key);
        return res.json({ message: `Key "${key}" incremented`, newValue });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to increment key. Make sure the value is an integer.' });
    }
});

// 4. EXPIRE Endpoint - Sets expiration time (TTL) on an existing key
// POST http://localhost:3001/expire
app.post('/expire', async (req, res) => {
    const { key, seconds } = req.body;
    
    if (!key || !seconds) {
        return res.status(400).json({ error: 'Key and seconds are required' });
    }
    
    try {
        const success = await redis.expire(key, parseInt(seconds, 10));
        if (success === 1) {
            return res.json({ message: `Expiration of ${seconds}s set for key "${key}"` });
        } else {
            return res.status(404).json({ error: `Key "${key}" does not exist` });
        }
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Basic Strings API running on http://localhost:${PORT}`);
});
