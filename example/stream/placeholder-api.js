const express = require('express');
const axios = require('axios');
const { redis, PORTS } = require('../../config');

const app = express();
const PORT = PORTS.placeholder;

const READS_STREAM_KEY = 'stream:posts:reads';

// GET http://localhost:3002/post/:id
// Caching pattern: String Cache + Stream Event Logging
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
        
        // Append log to Stream (time ordered, persistent append-only log)
        const messageId = await redis.xadd(
            READS_STREAM_KEY,
            '*',
            'post_id', id,
            'title', postData.title.substring(0, 30),
            'user_id', postData.userId.toString(),
            'queried_at', new Date().toISOString()
        );
        
        // Cap the stream to a max length of 100 entries to prevent memory leak
        await redis.xtrim(READS_STREAM_KEY, 'MAXLEN', '~', 100);
        console.log(`[Stream Logged] Appended event to ${READS_STREAM_KEY}. Message ID: ${messageId}`);
        
        return res.json({
            source,
            streamMessageId: messageId,
            data: postData
        });
    } catch (err) {
        if (err.response && err.response.status === 404) {
            return res.status(404).json({ error: `Post with ID ${id} not found` });
        }
        return res.status(500).json({ error: err.message });
    }
});

// GET http://localhost:3002/stream-logs
// Read recent logs from stream
app.get('/stream-logs', async (req, res) => {
    try {
        const entries = await redis.xrange(READS_STREAM_KEY, '-', '+', 'COUNT', 10);
        
        const formatted = entries.map(([id, fields]) => {
            const data = {};
            for (let i = 0; i < fields.length; i += 2) {
                data[fields[i]] = fields[i + 1];
            }
            return { id, data };
        });
        
        return res.json({
            message: 'Recent post read stream events (Latest 10)',
            count: formatted.length,
            events: formatted
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Placeholder Streams API running on http://localhost:${PORT}`);
});
