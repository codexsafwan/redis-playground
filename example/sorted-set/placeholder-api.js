const express = require('express');
const axios = require('axios');
const { redis, PORTS } = require('../../config');

const app = express();
const PORT = PORTS.placeholder;

const VIEWS_LEADERBOARD_KEY = 'posts:views:leaderboard';

// GET http://localhost:3002/post/:id
// Caching pattern: String Cache (post details) + Sorted Set (increment views leaderboard)
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
        
        // Atomically increment the view score of this post in the Sorted Set
        await redis.zincrby(VIEWS_LEADERBOARD_KEY, 1, `post:${id}`);
        
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

// GET http://localhost:3002/popular
// Retrieves the top 5 most viewed posts from the Sorted Set
app.get('/popular', async (req, res) => {
    try {
        // Fetch top 5 items from the Sorted Set with their view counts (scores)
        const topPosts = await redis.zrevrange(VIEWS_LEADERBOARD_KEY, 0, 4, 'WITHSCORES');
        
        const leaderboard = [];
        const pipeline = redis.pipeline();
        
        for (let i = 0; i < topPosts.length; i += 2) {
            const member = topPosts[i];
            const views = parseInt(topPosts[i + 1], 10);
            
            leaderboard.push({ member, views });
            // Retrieve details for this post from the Cache pipeline
            pipeline.get(member);
        }
        
        const cachedDetails = await pipeline.exec();
        
        const results = leaderboard.map((item, index) => {
            const detailStr = cachedDetails[index][1];
            return {
                postId: item.member.split(':')[1],
                views: item.views,
                details: detailStr ? JSON.parse(detailStr) : { message: 'Details expired from Cache' }
            };
        });
        
        return res.json({
            message: 'Top 5 most popular posts queried via this API',
            count: results.length,
            leaderboard: results
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Placeholder Sorted Sets API running on http://localhost:${PORT}`);
});
