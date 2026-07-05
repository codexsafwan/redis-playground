# Redis Data Types Specification: Sorted Sets (ZSets)

## 1. Overview
Sorted Sets are a hybrid between Sets and Lists. Like Sets, they consist of unique, non-repeating string elements. However, unlike standard Sets, every member in a Sorted Set is associated with a floating-point **score**. The members are kept in a sorted state at all times, ordered from lowest to highest score.

---

## 2. Pros & Cons

### Pros
* **Real-time Sorting**: Elements are sorted at insertion time. Updates are fast ($O(\log N)$), which keeps leaderboards live and accurate.
* **Flexible Range Queries**: You can query elements by rank index (`ZRANGE`), by score value bounds (`ZRANGEBYSCORE`), or lexicographically.
* **Score Updates**: You can easily increment or decrement scores using `ZINCRBY`.

### Cons
* **Write Overhead**: Adding or updating elements takes $O(\log N)$ time, which is slower than basic Sets or Lists ($O(1)$).
* **High Memory Consumption**: Sorted Sets use a dual-index architecture under the hood, making them one of the most memory-intensive data structures in Redis.

---

## 3. Under the Hood (How it Works)
Redis uses a dual encoding scheme for Sorted Sets based on configuration thresholds:

### Listpack / Ziplist Encoding
For small sorted sets (number of elements $\le$ `zset-max-listpack-entries` [default: 128] and element sizes $\le$ `zset-max-listpack-value` [default: 64 bytes]), Redis stores the data as a single contiguous array (a **listpack** or **ziplist**).
* Inside the listpack, member-score pairs are stored consecutively (e.g., `[member1, score1, member2, score2]`).
* The array is kept sorted by score, requiring shifts on insert.

### Skiplist & Hashtable Encoding
When the set exceeds those limits, it upgrades to a compound structure containing:
1. **Hash Table (`dict`)**: Maps member strings to their floating-point scores. This allows $O(1)$ lookup for `ZSCORE` or membership tests.
2. **Skip List (`zskiplist`)**: A probabilistic multi-level linked list. It allows searching, inserting, and deleting elements in $O(\log N)$ average time, and traversing ranges sequentially in $O(1)$ per step.

```
Skip List Index:
Level 3:  [Header] ----------------------------> [Node C: Score 50] --------------------> NULL
Level 2:  [Header] ------------> [Node B: Score 20] -> [Node C: Score 50] --------------------> NULL
Level 1:  [Header] -> [Node A: Score 10] -> [Node B: Score 20] -> [Node C: Score 50] -> [Node D: Score 90] -> NULL
```

---

## 4. Why, Where, and When

### Why Use Sorted Sets?
Use Sorted Sets whenever you have records that must be dynamically ordered by a changing numeric attribute (like timestamps, points, view counts, or priority weights) and you need to query ranges of these items efficiently.

### Where to Use Sorted Sets?
* **Gaming Leaderboards**: Tracking and displaying live top player ranks.
* **Sliding Window Rate Limiters**: Preventing request bursts by tracking precise request timestamps.
* **Delayed Job Queues**: Storing tasks with a target execution timestamp as their score, processing them only when the current time is $\ge$ score.

### When to Use Sorted Sets?
* Use Sorted Sets when you need to fetch items within score ranges (e.g. "scores between 100 and 200").
* Use Sorted Sets when you need to keep a capped list of sorted items (e.g., keeping only the top 100 high-scorers and removing the rest).
* Do **not** use Sorted Sets if scores are arbitrary and sorting is irrelevant (use **Sets** or **Hashes**).

---

## 5. Real-Life Project Use Case: Delayed Job Queue
In an e-commerce platform, you want to automatically cancel an unpaid order after 30 minutes. 

### Architecture Flow
1. When an order is created, the system adds the order ID to a Sorted Set named `orders:delayed` with the score set to the target epoch timestamp (e.g. `now + 1800` seconds).
2. A background worker periodically polls the Sorted Set for items whose scores are less than or equal to the current time (`now`).
3. The worker pops these items, cancels the orders, and updates the database.

```
[Order Created] ---> ZADD orders:delayed <timestamp> <order_id>
                                  |
                           (Background Poll)
                                  v
              ZRANGEBYSCORE orders:delayed -inf <current_time> LIMIT 0 10
                                  |
                         (Process & Remove)
                                  v
                     ZREM orders:delayed <order_id>
```

### Redis CLI Commands
```bash
# Add order 555 to execute at epoch 1719880000 (30 minutes from creation)
ZADD orders:delayed 1719880000 "order:555"
ZADD orders:delayed 1719880500 "order:556"

# Worker checks for expired orders (assume current time is 1719880100)
ZRANGEBYSCORE orders:delayed -inf 1719880100 WITHSCORES
# -> Returns: "order:555" (since 1719880000 <= 1719880100)

# Remove the job once processed to prevent other workers from picking it up
ZREM orders:delayed "order:555"
```

### Node.js (`ioredis`) Implementation
```javascript
const redis = require('../client');

// Enqueue a delayed job (delay in milliseconds)
async function scheduleDelayedJob(orderId, delayMs) {
    const executeAt = Date.now() + delayMs;
    await redis.zadd('orders:delayed', executeAt, `order:${orderId}`);
    console.log(`Order ${orderId} scheduled to cancel in ${delayMs / 1000}s`);
}

// Background Worker Poll Function
async function pollDelayedJobs() {
    const now = Date.now();
    
    // Fetch jobs that are ready to run (score <= now)
    // We limit to 10 at a time to prevent blocking
    const jobs = await redis.zrangebyscore('orders:delayed', '-inf', now, 'LIMIT', 0, 10);
    
    for (const job of jobs) {
        // Attempt to atomically claim the job by removing it
        const claimed = await redis.zrem('orders:delayed', job);
        
        if (claimed === 1) {
            const orderId = job.split(':')[1];
            console.log(`[Worker] Cancelling unpaid order: ${orderId}`);
            // Perform actual database cancellation here...
        }
    }
}

// Example usage:
// await scheduleDelayedJob('555', 5000); // 5 seconds delay
// setInterval(pollDelayedJobs, 1000); // Poll every second
```

---

## 🛠️ Practice Exercise Code
Check out the fully functional Express API files in this playground:
* 🗂️ **[example/sorted-set/basic.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/sorted-set/basic.js)**: Raw Sorted Set commands (`ZADD`, `ZREM`, `ZRANGE`, `ZREVRANGE`, `ZSCORE`, `ZRANK`, `ZINCRBY`).
* 🗂️ **[example/sorted-set/placeholder-api.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/sorted-set/placeholder-api.js)**: Real-time leaderboard for post views count.
* 🗂️ **[example/sorted-set/mysql-cache.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/sorted-set/mysql-cache.js)**: Paginated search results ranking and caching.
