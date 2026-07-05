const express = require('express');
const { redis, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.transactions;

// Initialize user balances for testing transactions
async function initBalances() {
    await redis.set('balance:alice', 100);
    await redis.set('balance:bob', 50);
    console.log('Balances initialized: Alice = 100, Bob = 50');
}

// ==========================================
// 1. PIPELINING DEMO - Batch inserts to save round trips
// POST http://localhost:3005/pipeline
// ==========================================
app.post('/pipeline', async (req, res) => {
    const count = parseInt(req.body.count || '100', 10);
    
    try {
        // Measure sequential execution time (bad practice for bulk ops)
        const startSeq = Date.now();
        for (let i = 0; i < count; i++) {
            await redis.set(`seq:key:${i}`, `value:${i}`);
        }
        const timeSeq = Date.now() - startSeq;
        
        // Measure pipelined execution time (good practice)
        const startPipe = Date.now();
        const pipeline = redis.pipeline();
        for (let i = 0; i < count; i++) {
            pipeline.set(`pipe:key:${i}`, `value:${i}`);
        }
        await pipeline.exec();
        const timePipe = Date.now() - startPipe;
        
        // Cleanup generated test keys in background
        const cleanupPipeline = redis.pipeline();
        for (let i = 0; i < count; i++) {
            cleanupPipeline.del(`seq:key:${i}`);
            cleanupPipeline.del(`pipe:key:${i}`);
        }
        await cleanupPipeline.exec();
        
        return res.json({
            message: `Successfully executed ${count} set operations`,
            sequentialTimeMs: timeSeq,
            pipelinedTimeMs: timePipe,
            speedImprovementPercentage: parseFloat(((timeSeq - timePipe) / timeSeq * 100).toFixed(2))
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. TRANSACTION DEMO (MULTI/EXEC/WATCH)
// POST http://localhost:3005/transfer
// Safe atomic balance transfer with Optimistic Locking
// ==========================================
app.post('/transfer', async (req, res) => {
    const { fromUser, toUser, amount } = req.body;
    
    if (!fromUser || !toUser || !amount) {
        return res.status(400).json({ error: 'fromUser, toUser, and amount are required' });
    }
    
    const transferAmount = parseInt(amount, 10);
    if (transferAmount <= 0) {
        return res.status(400).json({ error: 'Transfer amount must be positive' });
    }
    
    const fromKey = `balance:${fromUser}`;
    const toKey = `balance:${toUser}`;
    
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
        attempts++;
        try {
            // Step 1: Watch the sender's key for changes
            await redis.watch(fromKey);
            
            // Step 2: Retrieve the sender's current balance
            const balanceStr = await redis.get(fromKey);
            const balance = parseInt(balanceStr || '0', 10);
            
            if (balance < transferAmount) {
                await redis.unwatch(); // Release watches
                return res.status(400).json({ error: `Insufficient funds. Current balance: ${balance}` });
            }
            
            // Step 3: Start Transaction Block
            const tx = redis.multi();
            tx.decrby(fromKey, transferAmount);
            tx.incrby(toKey, transferAmount);
            
            // Step 4: Execute Transaction
            // If another client modified 'fromKey' after we ran WATCH, this will return null
            const results = await tx.exec();
            
            if (results === null) {
                console.log(`[Transaction Conflict] Attempt ${attempts} failed due to modified key. Retrying...`);
                // Wait briefly before retrying
                await new Promise(resolve => setTimeout(resolve, 50));
                continue; // Try again
            }
            
            // Transaction succeeded
            const newFromBalance = results[0][1];
            const newToBalance = results[1][1];
            
            return res.json({
                message: `Successfully transferred ${transferAmount} credits from ${fromUser} to ${toUser}`,
                sender: { name: fromUser, newBalance: newFromBalance },
                recipient: { name: toUser, newBalance: newToBalance },
                attemptsRequired: attempts
            });
        } catch (err) {
            await redis.unwatch(); // Clean up watches on error
            return res.status(500).json({ error: err.message });
        }
    }
    
    return res.status(409).json({ error: 'Transaction failed due to concurrency conflict. Please try again later.' });
});

app.listen(PORT, async () => {
    await initBalances();
    console.log(`Transactions API running on http://localhost:${PORT}`);
});
