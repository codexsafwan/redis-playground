const express = require('express');
const { redis, PORTS } = require('../../config');

const app = express();
const PORT = PORTS.rateLimiter;

// ==========================================
// 1. FIXED WINDOW RATE LIMITER (String counter)
// Limit: 5 requests per 10 seconds
// ==========================================
app.get('/rate-limit/fixed', async (req, res) => {
    const userId = req.query.userId || 'default_user';
    const key = `rate:fixed:${userId}`;
    const limit = 5;
    const windowSeconds = 10;
    
    try {
        const count = await redis.incr(key);
        
        if (count === 1) {
            // New window started, set expiration
            await redis.expire(key, windowSeconds);
        }
        
        const ttl = await redis.ttl(key);
        
        if (count > limit) {
            return res.status(429).json({
                error: 'Too Many Requests',
                algorithm: 'Fixed Window',
                limit,
                currentCount: count,
                retryAfterSeconds: ttl
            });
        }
        
        return res.json({
            message: 'Request allowed',
            algorithm: 'Fixed Window',
            limit,
            currentCount: count,
            windowTimeRemainingSeconds: ttl
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. SLIDING WINDOW LOG RATE LIMITER (Sorted Set)
// Limit: 5 requests per 10 seconds
// ==========================================
app.get('/rate-limit/sliding', async (req, res) => {
    const userId = req.query.userId || 'default_user';
    const key = `rate:sliding:${userId}`;
    const limit = 5;
    const windowMs = 10000; // 10 seconds in ms
    
    try {
        const now = Date.now();
        const clearBefore = now - windowMs;
        const requestId = `${now}-${Math.random().toString(36).substr(2, 5)}`;
        
        // Transaction to add, remove old records, and get count atomically
        const pipeline = redis.pipeline();
        pipeline.zadd(key, now, requestId);
        pipeline.zremrangebyscore(key, '-inf', clearBefore);
        pipeline.zcard(key);
        pipeline.expire(key, 15); // Auto-cleanup if idle
        
        const results = await pipeline.exec();
        const currentCount = results[2][1];
        
        if (currentCount > limit) {
            return res.status(429).json({
                error: 'Too Many Requests',
                algorithm: 'Sliding Window Log',
                limit,
                currentCount,
                message: `Limit exceeded. Max ${limit} requests in 10s.`
            });
        }
        
        return res.json({
            message: 'Request allowed',
            algorithm: 'Sliding Window Log',
            limit,
            currentCount
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3. TOKEN BUCKET RATE LIMITER (Lua Script)
// Bucket Capacity: 10 tokens
// Refill Rate: 1 token per 2 seconds (0.5 tokens/sec)
// Cost: 1 token per request
// ==========================================
const TOKEN_BUCKET_SCRIPT = `
    local key = KEYS[1]
    local capacity = tonumber(ARGV[1])
    local refill_rate = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])
    local cost = tonumber(ARGV[4])

    local data = redis.call('HMGET', key, 'tokens', 'last_updated')
    local tokens = tonumber(data[1])
    local last_updated = tonumber(data[2])

    if not tokens then
        tokens = capacity
        last_updated = now
    else
        local elapsed = now - last_updated
        tokens = math.min(capacity, tokens + (elapsed * refill_rate))
        last_updated = now
    end

    if tokens >= cost then
        tokens = tokens - cost
        redis.call('HMSET', key, 'tokens', tokens, 'last_updated', last_updated)
        redis.call('EXPIRE', key, 600)
        return {1, tokens} -- Return [success_status, tokens_remaining]
    else
        redis.call('HMSET', key, 'tokens', tokens, 'last_updated', last_updated)
        return {0, tokens}
    end
`;

let scriptSha = null;

app.get('/rate-limit/token-bucket', async (req, res) => {
    const userId = req.query.userId || 'default_user';
    const key = `rate:token:${userId}`;
    const capacity = 10;
    const refillRate = 0.5; // 0.5 tokens per second
    const now = Date.now() / 1000; // Epoch in seconds
    
    try {
        if (!scriptSha) {
            scriptSha = await redis.script('LOAD', TOKEN_BUCKET_SCRIPT);
        }
        
        let result;
        try {
            result = await redis.evalsha(scriptSha, 1, key, capacity, refillRate, now, 1);
        } catch (err) {
            if (err.message.includes('NOSCRIPT')) {
                scriptSha = await redis.script('LOAD', TOKEN_BUCKET_SCRIPT);
                result = await redis.evalsha(scriptSha, 1, key, capacity, refillRate, now, 1);
            } else {
                throw err;
            }
        }
        
        const [allowed, tokensRemaining] = result;
        
        if (allowed === 0) {
            return res.status(429).json({
                error: 'Too Many Requests',
                algorithm: 'Token Bucket',
                capacity,
                tokensRemaining: parseFloat(tokensRemaining.toFixed(2)),
                message: 'Bucket empty. Wait for refill.'
            });
        }
        
        return res.json({
            message: 'Request allowed',
            algorithm: 'Token Bucket',
            capacity,
            tokensRemaining: parseFloat(tokensRemaining.toFixed(2))
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Advanced Rate Limiting API running on http://localhost:${PORT}`);
});
