const express = require('express');
const { redis, mysqlPool: pool, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.mysql;
const STREAM_KEY = 'stream:users:mutations';
const GROUP_NAME = 'group:sync_processors';

// Automatically create table and setup consumer group on startup
async function initDb() {
    try {
        const connection = await pool.getConnection();
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        connection.release();
        console.log('Database initialized successfully: "users" table is ready.');
        
        // Setup Consumer Group
        try {
            await redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '0', 'MKSTREAM');
            console.log(`Consumer group "${GROUP_NAME}" verified/created.`);
        } catch (err) {
            if (!err.message.includes('BUSYGROUP')) throw err;
        }
    } catch (err) {
        console.error('Failed to initialize database/stream setup:', err.message);
    }
}

// Helper to push mutation logs to the Redis Stream
async function publishSyncEvent(action, userId, details) {
    try {
        const messageId = await redis.xadd(
            STREAM_KEY,
            'MAXLEN', '~', 500, // Keep stream capped to 500 entries
            '*',
            'action', action,
            'userId', String(userId),
            'details', String(details),
            'published_at', new Date().toISOString()
        );
        console.log(`[Stream Published] Event ID: ${messageId}`);
    } catch (err) {
        console.error('Failed to publish sync event to stream:', err.message);
    }
}

// 1. CREATE USER - Inserts to DB and publishes to Stream
// POST http://localhost:3003/users
app.post('/users', async (req, res) => {
    const { name, email, role } = req.body;
    
    if (!name || !email) {
        return res.status(400).json({ error: 'Name and email are required' });
    }
    
    try {
        const [result] = await pool.query(
            'INSERT INTO users (name, email, role) VALUES (?, ?, ?)',
            [name, email, role || 'user']
        );
        
        const newUser = { id: result.insertId, name, email, role: role || 'user' };
        
        // Publish mutation to Stream
        await publishSyncEvent('CREATE', newUser.id, `Created user ${newUser.name}`);
        
        return res.status(201).json({ message: 'User created and sync event published', user: newUser });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Email already exists' });
        }
        return res.status(500).json({ error: err.message });
    }
});

// 2. UPDATE USER - Updates DB and publishes to Stream
// PUT http://localhost:3003/users/:id
app.put('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { name, email, role } = req.body;
    
    try {
        const [result] = await pool.query(
            'UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), role = COALESCE(?, role) WHERE id = ?',
            [name, email, role, id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Publish mutation to Stream
        await publishSyncEvent('UPDATE', id, `Updated fields: name=${!!name}, email=${!!email}, role=${!!role}`);
        
        return res.json({ message: `User ${id} updated. Sync event published.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. DELETE USER - Deletes from DB and publishes to Stream
// DELETE http://localhost:3003/users/:id
app.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Publish mutation to Stream
        await publishSyncEvent('DELETE', id, `Deleted user`);
        
        return res.json({ message: `User ${id} deleted. Sync event published.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 4. SYNC WORKER PROCESS - Read and acknowledge sync events from stream
// GET http://localhost:3003/sync/process?consumer=worker_1
app.get('/sync/process', async (req, res) => {
    const consumer = req.query.consumer || 'sync_worker_1';
    
    try {
        // Read unread messages from group
        const results = await redis.xreadgroup(
            'GROUP', GROUP_NAME, consumer,
            'COUNT', 5,
            'STREAMS', STREAM_KEY, '>'
        );
        
        if (!results || results.length === 0) {
            return res.json({ message: 'No new synchronization events to process', eventsProcessedCount: 0, events: [] });
        }
        
        const [_, messages] = results[0];
        const processedEvents = [];
        
        const pipeline = redis.pipeline();
        
        messages.forEach(([id, fields]) => {
            const data = {};
            for (let i = 0; i < fields.length; i += 2) {
                data[fields[i]] = fields[i + 1];
            }
            
            // Simulate performing a synchronization action (e.g. syncing search index)
            console.log(`[Sync Worker] Processing mutation event ID ${id}: User ${data.userId} -> Action ${data.action}`);
            processedEvents.push({ id, data });
            
            // Acknowledge the message atomically in pipeline
            pipeline.xack(STREAM_KEY, GROUP_NAME, id);
        });
        
        await pipeline.exec();
        console.log(`[Sync Worker] Processed and acknowledged ${messages.length} events`);
        
        return res.json({
            message: `Successfully processed and acknowledged ${messages.length} sync events`,
            eventsProcessedCount: messages.length,
            events: processedEvents
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, async () => {
    await initDb();
    console.log(`MySQL mutation streaming API running on http://localhost:${PORT}`);
});
