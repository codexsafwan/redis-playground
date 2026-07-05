const express = require('express');
const axios = require('axios');
const { redis, PORTS } = require('../../config');

const app = express();
const PORT = PORTS.placeholder;

// GET http://localhost:3002/post/:id
// Caching pattern: String Cache + Bitfield (packing metadata keys in binary offset)
app.get('/post/:id', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `post:${id}`;
    const bitfieldKey = `post:bitfield:${id}`;
    
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
        
        // Pack metadata using Bitfield
        // userId: unsigned 8-bit integer (u8) at bit offset 0
        // postId: unsigned 16-bit integer (u16) at bit offset 8
        await redis.bitfield(
            bitfieldKey,
            'SET', 'u8', 0, parseInt(postData.userId, 10),
            'SET', 'u16', 8, parseInt(postData.id, 10)
        );
        await redis.expire(bitfieldKey, 120);
        console.log(`[Bitfield Cached] Packed metadata (userId, id) inside ${bitfieldKey}`);
        
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

// GET http://localhost:3002/post/:id/bitfields
// Decodes and returns the packed metadata from the Bitfield
app.get('/post/:id/bitfields', async (req, res) => {
    const { id } = req.params;
    const bitfieldKey = `post:bitfield:${id}`;
    
    try {
        const results = await redis.bitfield(
            bitfieldKey,
            'GET', 'u8', 0,
            'GET', 'u16', 8
        );
        
        const [userId, postId] = results;
        
        if (!userId && !postId) {
            return res.status(404).json({ error: `No bitfield metadata found for post ${id}` });
        }
        
        return res.json({
            key: bitfieldKey,
            decodedMetadata: {
                userId,
                postId
            }
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Placeholder Bitfields API running on http://localhost:${PORT}`);
});
