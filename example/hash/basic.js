const express = require('express');
const { redis, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.basic;

// 1. HSET - Set one or more fields in a hash
// POST http://localhost:3001/hset
app.post('/hset', async (req, res) => {
    const { key, fields } = req.body;
    
    if (!key || !fields || typeof fields !== 'object') {
        return res.status(400).json({ error: 'Key and fields (key-value object) are required' });
    }
    
    try {
        // HSET takes an object directly in modern ioredis versions
        const fieldsAdded = await redis.hset(key, fields);
        return res.json({ message: `Successfully set fields in hash "${key}"`, fieldsAdded });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. HGET - Get the value of a specific field in a hash
// GET http://localhost:3001/hget/user:100/name
app.get('/hget/:key/:field', async (req, res) => {
    const { key, field } = req.params;
    
    try {
        const value = await redis.hget(key, field);
        if (value === null) {
            return res.status(404).json({ error: `Field "${field}" not found in hash "${key}"` });
        }
        return res.json({ key, field, value });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. HGETALL - Get all fields and values in a hash
// GET http://localhost:3001/hgetall/user:100
app.get('/hgetall/:key', async (req, res) => {
    const { key } = req.params;
    
    try {
        const hash = await redis.hgetall(key);
        if (Object.keys(hash).length === 0) {
            return res.status(404).json({ error: `Hash "${key}" does not exist or is empty` });
        }
        return res.json({ key, hash });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 4. HINCRBY - Increment the numeric value of a hash field
// POST http://localhost:3001/hincr
app.post('/hincr', async (req, res) => {
    const { key, field, increment } = req.body;
    
    if (!key || !field || increment === undefined) {
        return res.status(400).json({ error: 'Key, field, and increment (number) are required' });
    }
    
    try {
        const newValue = await redis.hincrby(key, field, parseInt(increment, 10));
        return res.json({ message: `Field "${field}" in hash "${key}" incremented`, newValue });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to increment hash field. Make sure it is an integer.' });
    }
});

// 5. HDEL - Delete one or more fields from a hash
// POST http://localhost:3001/hdel
app.post('/hdel', async (req, res) => {
    const { key, fields } = req.body;
    
    if (!key || !fields || !Array.isArray(fields)) {
        return res.status(400).json({ error: 'Key and fields (array of strings) are required' });
    }
    
    try {
        const deletedCount = await redis.hdel(key, ...fields);
        return res.json({ message: `Successfully deleted ${deletedCount} fields from hash "${key}"`, deletedCount });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Basic Hashes API running on http://localhost:${PORT}`);
});
