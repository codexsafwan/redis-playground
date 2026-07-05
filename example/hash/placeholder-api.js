const express = require('express');
const axios = require('axios');
const { redis, PORTS } = require('../../config');

const app = express();
const PORT = PORTS.placeholder;

// GET http://localhost:3002/post/:id
// Caching pattern: Hash Cache (caching objects field-by-field)
app.get('/post/:id', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `post:hash:${id}`;
    
    try {
        // Step 1: Check Redis cache using HGETALL
        const cachedPost = await redis.hgetall(cacheKey);
        
        if (Object.keys(cachedPost).length > 0) {
            console.log(`[Cache Hit] Serving post ${id} from Redis Hash Cache`);
            return res.json({
                source: 'Redis Hash Cache',
                data: {
                    id: parseInt(cachedPost.id, 10),
                    userId: parseInt(cachedPost.userId, 10),
                    title: cachedPost.title,
                    body: cachedPost.body
                }
            });
        }
        
        // Step 2: Cache Miss - Query Placeholder API
        console.log(`[Cache Miss] Fetching post ${id} from Placeholder API...`);
        const response = await axios.get(`https://jsonplaceholder.typicode.com/posts/${id}`);
        const postData = response.data;
        
        // Step 3: Populate Redis Hash Cache with 30s TTL
        // Note: Field values must be strings, so we stringify numbers
        await redis.hset(cacheKey, {
            id: postData.id.toString(),
            userId: postData.userId.toString(),
            title: postData.title,
            body: postData.body
        });
        await redis.expire(cacheKey, 30);
        
        return res.json({
            source: 'Placeholder API',
            data: postData
        });
    } catch (err) {
        if (err.response && err.response.status === 404) {
            return res.status(404).json({ error: `Post with ID ${id} not found` });
        }
        return res.status(500).json({ error: err.message });
    }
});

// PATCH http://localhost:3002/post/:id/fields
// Updates specific fields inside the cached Hash without rewriting the entire payload
app.patch('/post/:id/fields', async (req, res) => {
    const { id } = req.params;
    const { title, body } = req.body;
    const cacheKey = `post:hash:${id}`;
    
    if (!title && !body) {
        return res.status(400).json({ error: 'Please specify "title" or "body" field to update' });
    }
    
    try {
        const exists = await redis.exists(cacheKey);
        if (exists === 0) {
            return res.status(404).json({ error: `Cache for post ${id} does not exist. Fetch it first.` });
        }
        
        const updates = {};
        if (title) updates.title = title;
        if (body) updates.body = body;
        
        await redis.hset(cacheKey, updates);
        console.log(`[Cache Updated] Mutated fields inside Hash key ${cacheKey}`);
        
        const updatedPost = await redis.hgetall(cacheKey);
        return res.json({
            message: `Successfully mutated cached fields for post ${id}`,
            data: updatedPost
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Placeholder Hashes API running on http://localhost:${PORT}`);
});
