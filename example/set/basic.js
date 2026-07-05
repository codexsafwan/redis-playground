const express = require('express');
const { redis, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.basic;

// 1. SADD - Add one or more members to a set
// POST http://localhost:3001/add
app.post('/add', async (req, res) => {
    const { key, members } = req.body;
    
    if (!key || !members || !Array.isArray(members)) {
        return res.status(400).json({ error: 'Key and members (array of strings) are required' });
    }
    
    try {
        const addedCount = await redis.sadd(key, ...members);
        return res.json({ message: `Successfully added ${addedCount} new members to set "${key}"`, addedCount });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. SMEMBERS - Get all members in a set
// GET http://localhost:3001/members/my-set
app.get('/members/:key', async (req, res) => {
    const { key } = req.params;
    
    try {
        const members = await redis.smembers(key);
        return res.json({ key, size: members.length, members });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. SISMEMBER - Check if element is member of a set
// GET http://localhost:3001/check?key=my-set&member=alice
app.get('/check', async (req, res) => {
    const { key, member } = req.query;
    
    if (!key || !member) {
        return res.status(400).json({ error: 'Parameters "key" and "member" are required' });
    }
    
    try {
        const isMember = await redis.sismember(key, member);
        return res.json({ key, member, exists: isMember === 1 });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 4. SREM - Remove members from a set
// POST http://localhost:3001/remove
app.post('/remove', async (req, res) => {
    const { key, members } = req.body;
    
    if (!key || !members || !Array.isArray(members)) {
        return res.status(400).json({ error: 'Key and members (array of strings) are required' });
    }
    
    try {
        const removedCount = await redis.srem(key, ...members);
        return res.json({ message: `Removed ${removedCount} members from set "${key}"`, removedCount });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 5. SINTER - Intersect multiple sets
// GET http://localhost:3001/intersect?keys=set1&keys=set2
app.get('/intersect', async (req, res) => {
    const { keys } = req.query;
    
    if (!keys || !Array.isArray(keys) || keys.length < 2) {
        return res.status(400).json({ error: 'At least two query parameter "keys" (e.g. ?keys=s1&keys=s2) are required' });
    }
    
    try {
        const commonMembers = await redis.sinter(...keys);
        return res.json({ intersectedKeys: keys, commonMembersSize: commonMembers.length, commonMembers });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Basic Sets API running on http://localhost:${PORT}`);
});
