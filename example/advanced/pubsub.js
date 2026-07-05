const express = require('express');
const Redis = require('ioredis');
const { redis, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.pubsub;

// Establish dedicated connection clients for pub/sub subscriptions (since subscribing blocks the client)
const subClient = new Redis({ host: '127.0.0.1', port: 6379 });
const expirySubClient = new Redis({ host: '127.0.0.1', port: 6379 });

// Automatically enable keyspace notifications and subscribe to events on startup
async function setupSubscriptions() {
    try {
        // Enable Expiry events in Redis config programmatically
        // E = Keyevent events, x = Expired events
        await redis.config('SET', 'notify-keyspace-events', 'Ex');
        console.log('Redis keyspace notifications enabled for Key Expiry events (Ex)');
        
        // 1. Subscribe to alerts channel
        await subClient.subscribe('alerts');
        console.log('Subscribed to Pub/Sub channel "alerts"');
        subClient.on('message', (channel, message) => {
            console.log(`🔊 [Pub/Sub Received] Channel "${channel}" -> Message: "${message}"`);
        });
        
        // 2. Subscribe to expired events across all databases
        await expirySubClient.psubscribe('__keyevent@*__:expired');
        console.log('Subscribed to Keyspace Notifications for Key Expirations');
        expirySubClient.on('pmessage', (pattern, channel, expiredKey) => {
            console.log(`⚠️  [Keyspace Notification] Key "${expiredKey}" has expired!`);
        });
    } catch (err) {
        console.error('Failed to configure subscriptions:', err.message);
    }
}

// ==========================================
// 1. PUBLISH MESSAGE - Send message to channel
// POST http://localhost:3006/publish
// ==========================================
app.post('/publish', async (req, res) => {
    const { channel, message } = req.body;
    
    if (!channel || !message) {
        return res.status(400).json({ error: 'channel and message are required' });
    }
    
    try {
        const subscribersCount = await redis.publish(channel, message);
        console.log(`[Pub/Sub Publish] Sent message to "${channel}". Receivers: ${subscribersCount}`);
        return res.json({ message: `Message published to channel "${channel}"`, activeSubscribers: subscribersCount });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. CREATE TEMPORARY KEY - Demonstrates Expiry notifications
// POST http://localhost:3006/set-temp
// ==========================================
app.post('/set-temp', async (req, res) => {
    const { key, seconds } = req.body;
    
    if (!key || !seconds) {
        return res.status(400).json({ error: 'key and seconds are required' });
    }
    
    try {
        const ttl = parseInt(seconds, 10);
        await redis.set(key, 'temporary_value', 'EX', ttl);
        console.log(`[Temp Key Created] Key "${key}" created with TTL of ${ttl}s. Expiry notification will trigger when time runs out.`);
        
        return res.json({ message: `Key "${key}" created. Watch the terminal logs in ${ttl} seconds for the expiry event.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, async () => {
    await setupSubscriptions();
    console.log(`Pub/Sub & Notifications API running on http://localhost:${PORT}`);
});
