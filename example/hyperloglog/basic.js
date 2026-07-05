const express = require('express');
const { redis, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.basic;

// 1. PFADD - Add elements to the HyperLogLog structure
// POST http://localhost:3001/add
app.post('/add', async (req, res) => {
    const { key, elements } = req.body;
    
    if (!key || !elements || !Array.isArray(elements)) {
        return res.status(400).json({ error: 'Key and elements (array of strings) are required' });
    }
    
    try {
        const changed = await redis.pfadd(key, ...elements);
        return res.json({ message: `Elements added to HyperLogLog "${key}"`, internalStateChanged: changed === 1 });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. PFCOUNT - Retrieve the estimated cardinality of the HyperLogLog
// GET http://localhost:3001/count/my-hll
app.get('/count/:key', async (req, res) => {
    const { key } = req.params;
    
    try {
        const count = await redis.pfcount(key);
        return res.json({ key, estimatedUniqueCount: count });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. PFMERGE - Merge multiple HyperLogLogs into a destination key
// POST http://localhost:3001/merge
app.post('/merge', async (req, res) => {
    const { destKey, sourceKeys } = req.body;
    
    if (!destKey || !sourceKeys || !Array.isArray(sourceKeys)) {
        return res.status(400).json({ error: 'destKey and sourceKeys (array of strings) are required' });
    }
    
    try {
        await redis.pfmerge(destKey, ...sourceKeys);
        const count = await redis.pfcount(destKey);
        return res.json({
            message: `Merged HyperLogLogs [${sourceKeys.join(', ')}] into "${destKey}"`,
            destKey,
            mergedEstimatedCount: count
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Basic HyperLogLogs API running on http://localhost:${PORT}`);
});
