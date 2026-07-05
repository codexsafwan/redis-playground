const express = require('express');
const { redis, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.basic;

// 1. SETBIT - Set a single bit at a given offset
// POST http://localhost:3001/setbit
app.post('/setbit', async (req, res) => {
    const { key, offset, value } = req.body;
    
    if (!key || offset === undefined || value === undefined) {
        return res.status(400).json({ error: 'Key, offset (integer), and value (0 or 1) are required' });
    }
    
    const bitVal = parseInt(value, 10);
    if (bitVal !== 0 && bitVal !== 1) {
        return res.status(400).json({ error: 'Value must be either 0 or 1' });
    }
    
    try {
        const previousValue = await redis.setbit(key, parseInt(offset, 10), bitVal);
        return res.json({ message: `Successfully set bit at offset ${offset} in key "${key}" to ${bitVal}`, previousValue });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. GETBIT - Retrieve a single bit at a given offset
// GET http://localhost:3001/getbit/active_users/105
app.get('/getbit/:key/:offset', async (req, res) => {
    const { key, offset } = req.params;
    
    try {
        const bit = await redis.getbit(key, parseInt(offset, 10));
        return res.json({ key, offset: parseInt(offset, 10), value: bit });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. BITCOUNT - Count the total number of bits set to 1
// GET http://localhost:3001/bitcount/active_users
app.get('/bitcount/:key', async (req, res) => {
    const { key } = req.params;
    
    try {
        const count = await redis.bitcount(key);
        return res.json({ key, totalBitsSet: count });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 4. BITOP - Perform bitwise operations (AND, OR, XOR, NOT)
// POST http://localhost:3001/bitop
app.post('/bitop', async (req, res) => {
    const { operation, destKey, keys } = req.body;
    
    if (!operation || !destKey || !keys || !Array.isArray(keys)) {
        return res.status(400).json({ error: 'operation (AND/OR/XOR/NOT), destKey, and keys (array of strings) are required' });
    }
    
    const op = operation.toUpperCase();
    if (!['AND', 'OR', 'XOR', 'NOT'].includes(op)) {
        return res.status(400).json({ error: 'Invalid operation. Must be AND, OR, XOR, or NOT' });
    }
    
    try {
        const resultLength = await redis.bitop(op, destKey, ...keys);
        const count = await redis.bitcount(destKey);
        return res.json({
            message: `Successfully executed bitwise ${op} operation and stored in "${destKey}"`,
            resultStringByteLength: resultLength,
            resultBitsSetCount: count
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Basic Bitmaps API running on http://localhost:${PORT}`);
});
