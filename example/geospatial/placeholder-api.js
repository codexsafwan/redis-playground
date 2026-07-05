const express = require('express');
const axios = require('axios');
const { redis, PORTS } = require('../../config');

const app = express();
const PORT = PORTS.placeholder;

const GEO_POSTS_KEY = 'posts:locations';

// GET http://localhost:3002/post/:id
// Caching pattern: String Cache + Geospatial (associates post with coordinate location)
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
        
        // Assign a mock location to the post based on ID:
        // SF region: base longitude = -122.4194, base latitude = 37.7749
        const postId = parseInt(id, 10);
        const lng = -122.4194 + (postId * 0.005);
        const lat = 37.7749 + (postId * 0.003);
        
        await redis.geoadd(GEO_POSTS_KEY, lng, lat, `post:${id}`);
        // Set TTL on GEO key (since it is a ZSet, we keep it for 300s)
        await redis.expire(GEO_POSTS_KEY, 300);
        
        return res.json({
            source,
            coordinates: { longitude: lng, latitude: lat },
            data: postData
        });
    } catch (err) {
        if (err.response && err.response.status === 404) {
            return res.status(404).json({ error: `Post with ID ${id} not found` });
        }
        return res.status(500).json({ error: err.message });
    }
});

// GET http://localhost:3002/nearby
// Find posts near given coordinates
// GET http://localhost:3002/nearby?lon=-122.41&lat=37.77&radius=10
app.get('/nearby', async (req, res) => {
    const { lon, lat, radius } = req.query;
    
    if (lon === undefined || lat === undefined || radius === undefined) {
        return res.status(400).json({ error: 'Query parameters "lon", "lat", and "radius" (in km) are required' });
    }
    
    try {
        const results = await redis.geosearch(
            GEO_POSTS_KEY,
            'FROMLONLAT', parseFloat(lon), parseFloat(lat),
            'BYRADIUS', parseFloat(radius), 'km',
            'ASC',
            'WITHDIST'
        );
        
        const pipeline = redis.pipeline();
        const matches = results.map(([member, dist]) => {
            pipeline.get(member);
            return { member, distanceKm: parseFloat(dist) };
        });
        
        const details = await pipeline.exec();
        
        const finalResults = matches.map((item, index) => {
            const detailStr = details[index][1];
            return {
                postId: item.member.split(':')[1],
                distanceKm: item.distanceKm,
                details: detailStr ? JSON.parse(detailStr) : { message: 'Details expired from String Cache' }
            };
        });
        
        return res.json({
            count: finalResults.length,
            posts: finalResults
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Placeholder Geospatial API running on http://localhost:${PORT}`);
});
