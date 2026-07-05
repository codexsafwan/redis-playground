const express = require('express');
const axios = require('axios');
const { redis, PORTS } = require('../../config');

const app = Bird = express();
app.use(express.json());

const PORT = PORTS.placeholder;
const HLL_READS_KEY = 'hll:unique:reads';

// GET http://localhost:3002/post/:id
// Caching pattern: String Cache + HyperLogLog (track unique posts visited)
app.get('/post/:id', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `post:${id}`;
    
    try {
        let postData;
        let source;
        
        const cachedPost = await redis.get(cacheKey);
        
        if (cachedPost) {
            postData = JSON.parse(cachedPost);
            source = 'Redis Cache';
        } else {
            console.log(`[Cache Miss] Fetching post ${id} from Placeholder API...`);
            const response = await axios.get(`https://jsonplaceholder.typicode.com/posts/${id}`);
            postData = response.data;
            await redis.set(cacheKey, JSON.stringify(postData), 'EX', 30);
            source = 'Placeholder API';
        }
        
        // Add the post ID to the HyperLogLog to estimate unique posts accessed
        await redis.pfadd(HLL_READS_KEY, `post:${id}`);
        
        return res.json({
            source,
            data: postData
        });
    } catch (err) {
        if (err.response && err.response.status === 404) {
            return res.status(404).json({ error: `Post with ID ${id} not found` });
        }
        return res.status(500).json({ error: err.message });
    }
});

// GET http://localhost:3002/unique-reads
// Returns estimated unique reads count using PFCOUNT
app.get('/unique-reads', async (req, res) => {
    try {
        const uniqueReadsCount = await redis.pfcount(HLL_READS_KEY);
        return res.json({
            message: 'Estimated unique posts read (HyperLogLog calculation)',
            estimatedCount: uniqueReadsCount,
            standardErrorLimit: '0.81%'
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Placeholder HyperLogLogs API running on http://localhost:${PORT}`);
});
