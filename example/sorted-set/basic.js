const express = require('express');
const { redis, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.basic;

// 1. ZADD - Add member with a score to a sorted set
// POST http://localhost:3001/add
app.post('/add', async (req, res) => {
    const { key, score, member } = req.body;
    
    if (!key || score === undefined || !member) {
        return res.status(400).json({ error: 'Key, score (number), and member are required' });
    }
    
    try {
        const added = await redis.zadd(key, parseFloat(score), member);
        return res.json({ message: `Member "${member}" added/updated in sorted set "${key}"`, added });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. ZRANGE / ZREVRANGE - Get range of members sorted by score
// GET http://localhost:3001/range?key=leaderboard&start=0&stop=-1&order=desc
app.get('/range', async (req, res) => {
    const { key, start, stop, order } = req.query;
    
    if (!key) {
        return res.status(400).json({ error: 'Query parameter "key" is required' });
    }
    
    const startIndex = parseInt(start || '0', 10);
    const stopIndex = parseInt(stop || '-1', 10);
    const useDesc = (order || 'desc').toLowerCase() === 'desc';
    
    try {
        let members;
        if (useDesc) {
            members = await redis.zrevrange(key, startIndex, stopIndex, 'WITHSCORES');
        } else {
            members = await redis.zrange(key, startIndex, stopIndex, 'WITHSCORES');
        }
        
        // Format the flat array ['member1', 'score1', 'member2', 'score2'] into structured array of objects
        const formatted = [];
        for (let i = 0; i < members.length; i += 2) {
            formatted.push({
                member: members[i],
                score: parseFloat(members[i + 1])
            });
        }
        
        return res.json({ key, range: { start: startIndex, stop: stopIndex }, size: formatted.length, leaderboard: formatted });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. ZINCRBY - Increment score of a member
// POST http://localhost:3001/incr
app.post('/incr', async (req, res) => {
    const { key, increment, member } = req.body;
    
    if (!key || increment === undefined || !member) {
        return res.status(400).json({ error: 'Key, increment (number), and member are required' });
    }
    
    try {
        const newScore = await redis.zincrby(key, parseFloat(increment), member);
        return res.json({ message: `Score of "${member}" incremented by ${increment}`, newScore: parseFloat(newScore) });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 4. ZSCORE / ZRANK - Get score and rank of a member
// GET http://localhost:3001/rank?key=leaderboard&member=Player1
app.get('/rank', async (req, res) => {
    const { key, member } = req.query;
    
    if (!key || !member) {
        return res.status(400).json({ error: 'Query parameters "key" and "member" are required' });
    }
    
    try {
        const score = await redis.zscore(key, member);
        if (score === null) {
            return res.status(404).json({ error: `Member "${member}" not found in sorted set "${key}"` });
        }
        
        // ZREVRANK is 0-indexed, so we add 1 to get standard leaderboard position
        const rank = await redis.zrevrank(key, member);
        
        return res.json({
            key,
            member,
            score: parseFloat(score),
            leaderboardRank: rank !== null ? rank + 1 : null
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 5. ZREM - Remove member from sorted set
// POST http://localhost:3001/remove
app.post('/remove', async (req, res) => {
    const { key, member } = req.body;
    
    if (!key || !member) {
        return res.status(400).json({ error: 'Key and member are required' });
    }
    
    try {
        const removed = await redis.zrem(key, member);
        if (removed === 1) {
            return res.json({ message: `Removed member "${member}" from sorted set "${key}"` });
        } else {
            return res.status(404).json({ error: `Member "${member}" not found in set` });
        }
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Basic Sorted Sets API running on http://localhost:${PORT}`);
});
