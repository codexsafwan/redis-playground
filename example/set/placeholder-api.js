const express = require('express');
const axios = require('axios');
const { redis, PORTS } = require('../../config');

const app = express();
const PORT = PORTS.placeholder;

const UNIQUE_USERS_KEY = 'unique:user_ids';

// GET http://localhost:3002/post/:id
// Caching pattern: String Cache (post details) + Set (unique authors logged)
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
        
        // Track the author (userId) of the fetched post in a Redis Set
        // Sets guarantee uniqueness automatically
        await redis.sadd(UNIQUE_USERS_KEY, postData.userId.toString());
        
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

// GET http://localhost:3002/unique-authors
// Retrieves all unique author userIds tracked in the Set
app.get('/unique-authors', async (req, res) => {
    try {
        const authorIds = await redis.smembers(UNIQUE_USERS_KEY);
        return res.json({
            message: 'Unique authors whose posts have been queried',
            count: authorIds.length,
            authorIds: authorIds.map(Number).sort((a,b) => a - b)
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Placeholder Sets API running on http://localhost:${PORT}`);
});
