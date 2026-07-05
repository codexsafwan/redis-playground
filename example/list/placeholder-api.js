const express = require('express');
const axios = require('axios');
const { redis, PORTS } = require('../../config');

const app = express();
const PORT = PORTS.placeholder;

const HISTORY_KEY = 'history:posts';
const PHOTOS_KEY = 'big:photos';

// 1. GET Single Post - Standard Cache-Aside
// GET http://localhost:3002/post/:id
app.get('/post/:id', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `post:${id}`;
    
    try {
        let postData;
        let source;
        
        const cachedPost = await redis.get(cacheKey);
        
        if (cachedPost) {
            console.log(`[Cache Hit] Serving post ${id} from Redis String Cache`);
            postData = JSON.parse(cachedPost);
            source = 'Redis Cache';
        } else {
            console.log(`[Cache Miss] Fetching post ${id} from Placeholder API...`);
            const response = await axios.get(`https://jsonplaceholder.typicode.com/posts/${id}`);
            postData = response.data;
            
            await redis.set(cacheKey, JSON.stringify(postData), 'EX', 30);
            source = 'Placeholder API';
        }
        
        const logEntry = `Fetched Post ID ${id} ("${postData.title.substring(0, 30)}...") at ${new Date().toISOString()}`;
        await redis.lpush(HISTORY_KEY, logEntry);
        await redis.ltrim(HISTORY_KEY, 0, 4);
        
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

// 2. GET Large Data (5,000 Photos) - Paginated List Cache Strategy
// GET http://localhost:3002/photos?page=1&limit=20
app.get('/photos', async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    
    const start = (page - 1) * limit;
    const stop = start + limit - 1;
    
    try {
        // Step 1: Check if the list exists in Redis by fetching its length
        const listLength = await redis.llen(PHOTOS_KEY);
        
        if (listLength > 0) {
            console.log(`[Cache Hit] Serving page ${page} from Redis List "${PHOTOS_KEY}"`);
            
            // Retrieve only the requested slice from the List
            const cachedItems = await redis.lrange(PHOTOS_KEY, start, stop);
            
            return res.json({
                source: 'Redis List Cache',
                page,
                limit,
                totalCached: listLength,
                data: cachedItems.map(item => JSON.parse(item))
            });
        }
        
        // Step 2: Cache Miss - Fetch all 5,000 photos from placeholder API
        console.log(`[Cache Miss] Fetching 5,000 photos from Placeholder API...`);
        const response = await axios.get('https://jsonplaceholder.typicode.com/photos');
        const photoData = response.data;
        
        // Step 3: Populate Redis List in chunks to avoid stack overflow issues
        const pipeline = redis.pipeline();
        const chunkSize = 500;
        
        for (let i = 0; i < photoData.length; i += chunkSize) {
            const chunk = photoData.slice(i, i + chunkSize).map(item => JSON.stringify(item));
            pipeline.rpush(PHOTOS_KEY, ...chunk);
        }
        
        // Set a 120-second expiration on the list key
        pipeline.expire(PHOTOS_KEY, 120);
        await pipeline.exec();
        console.log(`[Cache Populated] Pushed ${photoData.length} records into Redis List "${PHOTOS_KEY}" with 120s TTL`);
        
        // Slice and return the requested page data
        const pageData = photoData.slice(start, start + limit);
        
        return res.json({
            source: 'Placeholder API',
            page,
            limit,
            totalCached: photoData.length,
            data: pageData
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET http://localhost:3002/history
app.get('/history', async (req, res) => {
    try {
        const history = await redis.lrange(HISTORY_KEY, 0, 4);
        return res.json({
            message: 'Latest 5 search history logs',
            count: history.length,
            history
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// DELETE http://localhost:3002/history/clear
app.delete('/history/clear', async (req, res) => {
    try {
        await redis.del(HISTORY_KEY);
        return res.json({ message: 'History log cleared' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Placeholder List API running on http://localhost:${PORT}`);
});
