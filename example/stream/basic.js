const express = require('express');
const { redis, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.basic;

// 1. XADD - Append a message to a Stream
// POST http://localhost:3001/xadd
app.post('/xadd', async (req, res) => {
    const { key, fields } = req.body;
    
    if (!key || !fields || typeof fields !== 'object') {
        return res.status(400).json({ error: 'Key and fields (key-value object) are required' });
    }
    
    try {
        // Flatten the fields object: { a: 1, b: 2 } -> ['a', '1', 'b', '2']
        const flattened = [];
        for (const [k, v] of Object.entries(fields)) {
            flattened.push(k, String(v));
        }
        
        // '*' auto-generates the stream message ID based on current time
        const messageId = await redis.xadd(key, '*', ...flattened);
        return res.json({ message: `Successfully appended event to stream "${key}"`, messageId });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. XRANGE - Retrieve range of entries from a Stream
// GET http://localhost:3001/xrange?key=telemetry&start=-&stop=+&count=10
app.get('/xrange', async (req, res) => {
    const { key, start, stop, count } = req.query;
    
    if (!key) {
        return res.status(400).json({ error: 'Query parameter "key" is required' });
    }
    
    const startId = start || '-';
    const stopId = stop || '+';
    const limit = parseInt(count || '10', 10);
    
    try {
        const entries = await redis.xrange(key, startId, stopId, 'COUNT', limit);
        
        // Format Redis stream array response into structured objects
        const formatted = entries.map(([id, fields]) => {
            const data = {};
            for (let i = 0; i < fields.length; i += 2) {
                data[fields[i]] = fields[i + 1];
            }
            return { id, data };
        });
        
        return res.json({ key, count: formatted.length, entries: formatted });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. XGROUP CREATE - Create a consumer group
// POST http://localhost:3001/xgroup
app.post('/xgroup', async (req, res) => {
    const { key, group, startId } = req.body;
    
    if (!key || !group) {
        return res.status(400).json({ error: 'Key and group name are required' });
    }
    
    const id = startId || '$'; // Default to '$' (new messages only)
    
    try {
        // MKSTREAM creates the stream if it doesn't already exist
        await redis.xgroup('CREATE', key, group, id, 'MKSTREAM');
        return res.json({ message: `Successfully created consumer group "${group}" for stream "${key}" starting at ID "${id}"` });
    } catch (err) {
        if (err.message.includes('BUSYGROUP')) {
            return res.status(400).json({ error: 'Consumer group already exists' });
        }
        return res.status(500).json({ error: err.message });
    }
});

// 4. XREADGROUP - Read messages from a stream using a consumer group
// GET http://localhost:3001/xreadgroup?key=telemetry&group=processors&consumer=c1&count=2
app.get('/xreadgroup', async (req, res) => {
    const { key, group, consumer, count } = req.query;
    
    if (!key || !group || !consumer) {
        return res.status(400).json({ error: 'Parameters "key", "group", and "consumer" are required' });
    }
    
    const limit = parseInt(count || '1', 10);
    
    try {
        // '>' reads only new messages that have never been delivered to other group consumers
        const results = await redis.xreadgroup(
            'GROUP', group, consumer,
            'COUNT', limit,
            'STREAMS', key, '>'
        );
        
        if (!results || results.length === 0) {
            return res.json({ message: 'No new messages for this consumer group', entries: [] });
        }
        
        const [_, messages] = results[0];
        const formatted = messages.map(([id, fields]) => {
            const data = {};
            for (let i = 0; i < fields.length; i += 2) {
                data[fields[i]] = fields[i + 1];
            }
            return { id, data };
        });
        
        return res.json({ key, group, consumer, count: formatted.length, entries: formatted });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 5. XACK - Acknowledge that a message has been processed
// POST http://localhost:3001/xack
app.post('/xack', async (req, res) => {
    const { key, group, messageId } = req.body;
    
    if (!key || !group || !messageId) {
        return res.status(400).json({ error: 'Key, group name, and messageId are required' });
    }
    
    try {
        const acked = await redis.xack(key, group, messageId);
        return res.json({ message: `Message Acknowledged status`, acknowledged: acked === 1 });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Basic Streams API running on http://localhost:${PORT}`);
});
