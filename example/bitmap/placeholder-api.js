const express = require('express');
const axios = require('axios');
const { redis, PORTS } = require('../../config');

const app = express();
const PORT = PORTS.placeholder;

const VISITED_POSTS_BITMAP = 'stats:posts:visited';

// GET http://localhost:3002/post/:id
// Caching pattern: String Cache + Bitmap (set visited flag)
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
        
        // Mark the post ID as visited by setting the bit index "id" to 1
        const postIdInt = parseInt(id, 10);
        await redis.setbit(VISITED_POSTS_BITMAP, postIdInt, 1);
        
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

// GET http://localhost:3002/visited-count
// Returns the total count of unique posts visited using BITCOUNT
app.get('/visited-count', async (req, res) => {
    try {
        const uniqueCount = await redis.bitcount(VISITED_POSTS_BITMAP);
        return res.json({
            message: 'Unique post ids visited overall',
            count: uniqueCount
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Placeholder Bitmaps API running on http://localhost:${PORT}`);
});
