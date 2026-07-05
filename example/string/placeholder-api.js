const express = require('express');
const axios = require('axios');
const zlib = require('zlib');
const util = require('util');
const { redis, PORTS } = require('../../config');

const app = express();
const PORT = PORTS.placeholder;

const gzip = util.promisify(zlib.gzip);
const gunzip = util.promisify(zlib.gunzip);

// 1. GET Single Post - Standard Cache-Aside
// GET http://localhost:3002/post/:id
app.get('/post/:id', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `post:${id}`;
    
    try {
        const cachedPost = await redis.get(cacheKey);
        
        if (cachedPost) {
            console.log(`[Cache Hit] Serving post ${id} from Redis`);
            return res.json({
                source: 'Redis Cache',
                data: JSON.parse(cachedPost)
            });
        }
        
        console.log(`[Cache Miss] Fetching post ${id} from Placeholder API...`);
        const response = await axios.get(`https://jsonplaceholder.typicode.com/posts/${id}`);
        const postData = response.data;
        
        await redis.set(cacheKey, JSON.stringify(postData), 'EX', 30);
        
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

// 2. GET Large Data (5,000 Photos) - GZIP Compression Strategy
// GET http://localhost:3002/photos
app.get('/photos', async (req, res) => {
    const cacheKey = 'big:photos:gzip';
    
    try {
        // Step 1: Check Redis cache for compressed string
        const cachedBase64 = await redis.get(cacheKey);
        
        if (cachedBase64) {
            console.log(`[Cache Hit] Serving 5,000 photos from GZIP compressed Redis cache`);
            const buffer = Buffer.from(cachedBase64, 'base64');
            const decompressed = await gunzip(buffer);
            const photoData = JSON.parse(decompressed.toString());
            
            return res.json({
                source: 'Redis Compressed Cache',
                count: photoData.length,
                data: photoData.slice(0, 50) // Return first 50 to prevent flooding terminal/Postman
            });
        }
        
        // Step 2: Cache Miss - Fetch all 5,000 photos from placeholder API
        console.log(`[Cache Miss] Fetching 5,000 photos from Placeholder API...`);
        const response = await axios.get('https://jsonplaceholder.typicode.com/photos');
        const photoData = response.data;
        
        // Step 3: Compress JSON data and save in Redis with a 60-second TTL
        const rawString = JSON.stringify(photoData);
        const compressedBuffer = await gzip(rawString);
        const base64String = compressedBuffer.toString('base64');
        
        await redis.set(cacheKey, base64String, 'EX', 60);
        console.log(`[Cache Populated] Saved compressed photo dataset in Redis (${(base64String.length/1024).toFixed(2)} KB)`);
        
        return res.json({
            source: 'Placeholder API',
            count: photoData.length,
            data: photoData.slice(0, 50)
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// DELETE http://localhost:3002/post/:id/cache
app.delete('/post/:id/cache', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `post:${id}`;
    
    try {
        const deleted = await redis.del(cacheKey);
        if (deleted === 1) {
            return res.json({ message: `Cache invalidated for post ${id}` });
        } else {
            return res.status(404).json({ message: `No cache found for post ${id}` });
        }
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Placeholder Cache API running on http://localhost:${PORT}`);
});
