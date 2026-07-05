# Redis Advanced Guide: Rate Limiting & Advanced Patterns

This document covers advanced architectural patterns and optimization techniques in Redis, specifically focusing on advanced rate limiting strategies, atomicity via Lua scripting, pipelining, transactions, and real-time pub/sub structures.

---

## 1. Advanced Rate Limiting Strategies

Rate limiting controls the rate of traffic sent by a client. Choosing the right algorithm depends on memory limits, CPU usage, and the tolerance for traffic bursts.

### Algorithm Comparison

| Algorithm | Redis Data Structure | Pros | Cons |
| :--- | :--- | :--- | :--- |
| **Fixed Window** | String (`INCR`, `EXPIRE`) | Extremely low memory ($O(1)$ space), highly performant. | Boundary burst issue: permits up to $2 \times$ limit at window edges. |
| **Sliding Window Log** | Sorted Set (`ZADD`, `ZREMRANGEBY..`) | Highly accurate, precise timestamp tracking. | High memory usage; stores every request as an element in the Sorted Set. |
| **Sliding Window Counter** | Hashes (`HINCRBY`) | Memory efficient, prevents boundary bursts. | Harder to implement; assumes requests are evenly distributed. |
| **Token Bucket** | Hash + Lua Script | Handles traffic bursts gracefully, highly customizable. | Requires server-side calculation (CPU overhead). |

---

### Implementation A: Sliding Window Log (Sorted Sets)
This tracks every request timestamp. It removes timestamps older than the rate limit window and checks the remaining set size.

#### Logic Flow
1. Add the current timestamp (as both score and member) to a Sorted Set keyed by user ID.
2. Remove all elements in the set with a score older than `now - windowSize`.
3. Check the cardinality of the set using `ZCARD`. If it is less than the limit, allow the request; otherwise, block it.
4. Set an expiration on the Sorted Set key so idle users do not leak memory.

```bash
# Add request at epoch timestamp 1719880000
ZADD rate:user_123 1719880000 "1719880000-req1"

# Clear requests older than 60 seconds (1719880000 - 60 = 1719879940)
ZREMRANGEBYSCORE rate:user_123 -inf 1719879940

# Count remaining requests in the window
ZCARD rate:user_123
```

---

### Implementation B: Token Bucket (Lua Scripting)
The Token Bucket algorithm maintains a bucket of tokens up to a maximum capacity. Tokens refill over time at a constant rate. Each request consumes one token. If no tokens are left, the request is rejected.

To avoid running a background timer to refill tokens, we calculate the refilled tokens lazily upon each incoming request.

#### The Lua Script
We use Lua scripting to ensure the read-calculate-update cycle is executed **atomically** without race conditions.

```lua
-- KEYS[1]: The rate limit key (e.g., 'rate:token:user_123')
-- ARGV[1]: Max bucket capacity (e.g., 10 tokens)
-- ARGV[2]: Refill rate per second (e.g., 0.5 tokens/sec)
-- ARGV[3]: Current timestamp (in seconds)
-- ARGV[4]: Cost of request (usually 1)

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

-- Retrieve current bucket state
local data = redis.call('HMGET', key, 'tokens', 'last_updated')
local tokens = tonumber(data[1])
local last_updated = tonumber(data[2])

if not tokens then
    -- Bucket is new, initialize it to full capacity
    tokens = capacity
    last_updated = now
else
    -- Calculate refilled tokens based on elapsed time
    local elapsed = now - last_updated
    tokens = math.min(capacity, tokens + (elapsed * refill_rate))
    last_updated = now
end

-- Check if we have enough tokens
if tokens >= cost then
    tokens = tokens - cost
    redis.call('HMSET', key, 'tokens', tokens, 'last_updated', last_updated)
    redis.call('EXPIRE', key, 600) -- Keep key alive for 10 minutes
    return 1 -- Request Allowed
else
    -- Save the calculated (partially refilled) tokens even if rejected
    redis.call('HMSET', key, 'tokens', tokens, 'last_updated', last_updated)
    return 0 -- Rate Limited
end
```

---

## 2. Lua Scripting: Why and How
Redis executes Lua scripts **atomically** on the main thread. No other commands can run while a script is executing, eliminating race conditions without distributed locks.

### Why Use Lua Scripts?
1. **Atomicity**: Multiple operations are grouped together, ensuring consistent reads and writes.
2. **Reduced Latency**: All logic runs directly on the Redis server, eliminating network round-trip delays between operations.
3. **Bandwidth Savings**: Less data is transmitted back and forth.

### Node.js (`ioredis`) Implementation
Here is how to load and run the Token Bucket Lua script in an application:

```javascript
const redis = require('./client');

// Define Lua script
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
        return 1
    else
        redis.call('HMSET', key, 'tokens', tokens, 'last_updated', last_updated)
        return 0
    end
`;

// Define the rate limit checker using evalsha (pre-loaded script)
let scriptSha = null;

async function checkTokenBucketRateLimit(userId, capacity = 10, refillRate = 0.5) {
    const key = `rate:token:${userId}`;
    const now = Date.now() / 1000; // current time in seconds
    
    // Load script SHA to save bandwidth on subsequent calls
    if (!scriptSha) {
        scriptSha = await redis.script('LOAD', TOKEN_BUCKET_SCRIPT);
    }
    
    try {
        const result = await redis.evalsha(scriptSha, 1, key, capacity, refillRate, now, 1);
        return result === 1; // true if allowed, false if rate-limited
    } catch (err) {
        if (err.message.includes('NOSCRIPT')) {
            // Fallback if Redis script cache was cleared
            scriptSha = null;
            return checkTokenBucketRateLimit(userId, capacity, refillRate);
        }
        throw err;
    }
}
```

---

## 3. Pipelining vs Transactions
Both Pipelining and Transactions group commands together, but they serve completely different purposes.

### Pipelining
Pipelining is a network optimization technique. It allows a client to send multiple commands to the server at once without waiting for individual replies, reducing total Round-Trip Time (RTT) delay.
* **Execution**: Commands are sent in a batch. They are **not** guaranteed to run atomically; other clients' requests can interleave between pipelined commands on the server.
* **When to use**: Bulk inserts, populating caches, or warming up database indexes.

```javascript
// Pipelining example
const pipeline = redis.pipeline();
for (let i = 0; i < 1000; i++) {
    pipeline.set(`key:${i}`, `value:${i}`);
}
const results = await pipeline.exec(); // Single network trip
```

### Transactions (MULTI/EXEC)
Redis Transactions group commands into an isolated execution block.
* **Execution**: Once `MULTI` is sent, commands are queued on the server. They are executed sequentially and **atomically** (non-interleaved) only when `EXEC` is called.
* **Error Handling**: Unlike relational databases, Redis has **no rollback**. If a command fails inside a transaction (e.g. type error), the remaining queued commands will still execute.
* **Optimistic Locking (`WATCH`)**: You can watch keys for modifications. If any watched key is altered by another client before you call `EXEC`, the transaction fails automatically.

```javascript
// Optimistic Lock Transaction
async function incrementUniqueScore(userId) {
    const key = `user:${userId}:score`;
    
    await redis.watch(key); // Watch for modifications
    
    const currentScore = parseInt(await redis.get(key) || '0', 10);
    const newScore = currentScore + 10;
    
    const tx = redis.multi();
    tx.set(key, newScore);
    
    const result = await tx.exec(); 
    // If another client modified 'key' after WATCH was declared, 
    // result will be null (transaction discarded).
    return result !== null;
}
```

---

## 4. Real-time Pub/Sub & Keyspace Notifications

### Pub/Sub (Publish/Subscribe)
A decoupling mechanism where publishers send messages to channels without knowing who the subscribers are. Subscribers listen to channels and receive messages in real time.
* **Memory Footprint**: $O(1)$. Messages are pushed immediately and deleted from memory. If a client is disconnected, it misses messages.
* **Commands**: `PUBLISH`, `SUBSCRIBE`, `PSUBSCRIBE` (pattern subscribe).

### Keyspace Notifications
Allows clients to subscribe to channels in order to receive events affecting the Redis data set (e.g. key expiration, deletions, string changes).

#### Enabling Notifications
By default, keyspace notifications are disabled to save CPU. Enable them in `redis.conf` or via CLI:
```bash
CONFIG SET notify-keyspace-events Ex
```
*(Here `E` represents Keyevent events, and `x` represents Expired events).*

#### Listening to Expiry Events
You can subscribe to expiration events across all keys using pattern subscribing:
```javascript
const Redis = require('ioredis');
const sub = new Redis();

sub.psubscribe('__keyevent@*__:expired');

sub.on('pmessage', (pattern, channel, expiredKey) => {
    console.log(`Key expired: ${expiredKey}`);
    // Trigger cleanup jobs, email alerts, or synchronization logic
});
```
*(Note: Because Redis expires keys lazily or periodically in the background, there may be a slight delay between when a key's TTL expires and when the event is published).*

---

## 🛠️ Practice Exercise Code
Check out the fully functional Express API files demonstrating advanced Redis features:
* 🗂️ **[example/advanced/rate-limiter.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/advanced/rate-limiter.js)**: Rate limiting endpoints using Fixed Window, Sliding Window Log, and Lua Token Bucket.
* 🗂️ **[example/advanced/transactions.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/advanced/transactions.js)**: Benchmarking Pipeline speed versus credits transfer Transactions (MULTI/EXEC/WATCH).
* 🗂️ **[example/advanced/pubsub.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/advanced/pubsub.js)**: Standard Pub/Sub publisher/subscriber and real-time Keyspace Expiry notifications handler.
