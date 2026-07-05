const express = require('express');
const { redis, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.basic;

// 1. PUSH Endpoint - Adds elements to the left or right of a list
// POST http://localhost:3001/push
app.post('/push', async (req, res) => {
    const { key, value, direction } = req.body;
    
    if (!key || !value) {
        return res.status(400).json({ error: 'Key and Value are required' });
    }
    
    const dir = (direction || 'right').toLowerCase();
    
    try {
        let length;
        if (dir === 'left') {
            length = await redis.lpush(key, value);
        } else {
            length = await redis.rpush(key, value);
        }
        return res.json({ message: `Successfully pushed value to ${dir} of list "${key}"`, newListLength: length });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. POP Endpoint - Removes and returns elements from the left or right of a list
// POST http://localhost:3001/pop
app.post('/pop', async (req, res) => {
    const { key, direction } = req.body;
    
    if (!key) {
        return res.status(400).json({ error: 'Key is required' });
    }
    
    const dir = (direction || 'left').toLowerCase();
    
    try {
        let poppedValue;
        if (dir === 'right') {
            poppedValue = await redis.rpop(key);
        } else {
            poppedValue = await redis.lpop(key);
        }
        
        if (poppedValue === null) {
            return res.status(404).json({ error: `List "${key}" is empty or does not exist` });
        }
        return res.json({ message: `Successfully popped from ${dir}`, value: poppedValue });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. RANGE Endpoint - Fetches a range of elements from a list
// GET http://localhost:3001/range?key=task_list&start=0&stop=-1
app.get('/range', async (req, res) => {
    const { key, start, stop } = req.query;
    
    if (!key) {
        return res.status(400).json({ error: 'Query parameter "key" is required' });
    }
    
    const startIndex = parseInt(start || '0', 10);
    const stopIndex = parseInt(stop || '-1', 10); // Default to -1 (entire list)
    
    try {
        const elements = await redis.lrange(key, startIndex, stopIndex);
        return res.json({ key, range: { start: startIndex, stop: stopIndex }, elements });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 4. TRIM Endpoint - Trims a list to only contain the specified range
// POST http://localhost:3001/trim
app.post('/trim', async (req, res) => {
    const { key, start, stop } = req.body;
    
    if (!key || start === undefined || stop === undefined) {
        return res.status(400).json({ error: 'Key, start, and stop indices are required' });
    }
    
    try {
        await redis.ltrim(key, parseInt(start, 10), parseInt(stop, 10));
        return res.json({ message: `List "${key}" trimmed to range [${start}, ${stop}]` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 5. LENGTH Endpoint - Retrieves the total number of elements in a list
// GET http://localhost:3001/len/task_list
app.get('/len/:key', async (req, res) => {
    const { key } = req.params;
    
    try {
        const length = await redis.llen(key);
        return res.json({ key, length });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Basic Lists API running on http://localhost:${PORT}`);
});
