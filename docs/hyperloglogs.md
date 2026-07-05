# Redis Data Types Specification: HyperLogLogs (HLL)

## 1. Overview
HyperLogLog (HLL) is a probabilistic data structure used to estimate the cardinality (number of unique elements) of a set. Instead of storing the actual elements, it stores mathematical observations of values hashed into bits. It is designed to count unique items with extremely low memory requirements.

---

## 2. Pros & Cons

### Pros
* **Fixed Memory Limit**: Every HyperLogLog key uses a maximum of **12 KB** of memory, whether you add 10 items or 10 billion items.
* **Excellent Performance**: Adding items (`PFADD`) and counting cardinality (`PFCOUNT`) are constant-time $O(1)$ operations.
* **Server-side Merging**: Multiple HLL keys can be merged atomically (`PFMERGE`) to find the combined unique count.

### Cons
* **Probabilistic Approximation**: It does not provide an exact count. The cardinality estimate has a standard error rate of **0.81%**.
* **Write-Only/Lossy**: You cannot retrieve the actual elements that were added to the HLL. It only returns the counted estimate. If you need to list the unique elements, you must use **Sets**.

---

## 3. Under the Hood (How it Works)
Redis HyperLogLog implements the HyperLogLog algorithm with optimizations for memory storage.

### The Algorithm:
* Redis hashes incoming values into a 64-bit integer using the MurmurHash3 algorithm.
* The first 14 bits of the hash are used to determine which of the **16,384 registers ($2^{14}$)** the element belongs to.
* The remaining 50 bits of the hash are scanned to find the index of the first `1` bit (counting leading zeros).
* The register is updated to store the maximum number of leading zeros seen so far.
* The total cardinality is estimated using the harmonic mean of the registers, corrected for biases.

### Memory Optimization Encodings:
1. **Sparse Encoding**: For HLL keys containing few elements, Redis uses a highly compressed representation where registers with a value of `0` are represented by count sequences. This allows small counters to consume only a few bytes.
2. **Dense Encoding**: Once the sparse representation becomes too complex or the cardinality increases, Redis automatically converts the key into a dense array of 16,384 registers, each 6 bits wide ($16,384 \times 6\text{ bits} = 98,304\text{ bits} = 12,288\text{ bytes} \approx 12\text{ KB}$).

---

## 4. Why, Where, and When

### Why Use HyperLogLogs?
Use HyperLogLogs when you need to count unique items across massive datasets (millions or billions of logs) and you cannot afford the memory scaling cost of standard Sets, while a small error margin (< 1%) is acceptable.

### Where to Use HyperLogLogs?
* **Unique Page / Video View Counters**: Tracking unique user visits per article/video.
* **Unresolved IP Counters**: Counting distinct network clients connecting to a gateway.
* **Unique Search Query Auditing**: Estimating how many unique search queries were run.

### When to Use HyperLogLogs?
* Use HLL when memory conservation is a priority.
* Use HLL when you do not need to show users a list of the elements they added.
* Do **not** use HLL if you require 100% exact counts (e.g. accounting, financial ledgers).
* Do **not** use HLL if you need to perform deletion of individual items (HLL only supports adding; you cannot "remove" an element).

---

## 5. Real-Life Project Use Case: Video Streaming Unique Views Tracker
A video sharing platform (like YouTube) needs to display the number of unique views for videos. The system handles billions of plays and wants to prevent duplicate views from the same user on the same day without using gigabytes of RAM.

### Architecture Flow
1. A video play event occurs: User `user_889` watches Video `video_5012`.
2. The system adds the user ID to the video's HyperLogLog: `views:video:5012`.
3. The front-end fetches the views count using `PFCOUNT views:video:5012`.
4. Daily HLL keys can be merged to get weekly or monthly statistics.

```
User watches Video 5012
      |
      v
PFADD views:video:5012 "user_889" (Adds user to 12KB HLL key)
      |
PFCOUNT views:video:5012 -> Returns ~2,501,230 unique views (0.81% error margin)
```

### Redis CLI Commands
```bash
# Record views for video 102
PFADD views:video:102 "user_a"
PFADD views:video:102 "user_b"
PFADD views:video:102 "user_a" # Duplicate, count remains stable

# Fetch view count
PFCOUNT views:video:102
# -> Returns: 2

# Combine today's and yesterday's unique viewers to find overall reach
PFADD views:video:102:yesterday "user_b" "user_c"
PFMERGE views:video:102:combined views:video:102 views:video:102:yesterday
PFCOUNT views:video:102:combined
# -> Returns: 3 (users a, b, c)
```

### Node.js (`ioredis`) Implementation
```javascript
const redis = require('../client');

// Record a unique view
async function recordView(videoId, userId) {
    const key = `views:video:${videoId}`;
    await redis.pfadd(key, userId);
}

// Get the video view count estimation
async function getViewCount(videoId) {
    const key = `views:video:${videoId}`;
    return await redis.pfcount(key);
}

// Merge multiple video views to calculate total unique views across a category
async function getCategoryUniqueViews(categoryName, videoIdsArray) {
    const keysToMerge = videoIdsArray.map(id => `views:video:${id}`);
    const destKey = `views:category:${categoryName}:temp`;
    
    // Merge all individual video HLLs into one category HLL
    await redis.pfmerge(destKey, ...keysToMerge);
    
    // Retrieve calculation
    const count = await redis.pfcount(destKey);
    
    // Clean up temporary key
    await redis.del(destKey);
    
    return count;
}

// Usage Example:
// await recordView('5012', 'user_889');
// const views = await getViewCount('5012');
```

---

## 🛠️ Practice Exercise Code
Check out the fully functional Express API files in this playground:
* 🗂️ **[example/hyperloglog/basic.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/hyperloglog/basic.js)**: Raw HyperLogLog commands (`PFADD`, `PFCOUNT`, `PFMERGE`).
* 🗂️ **[example/hyperloglog/placeholder-api.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/hyperloglog/placeholder-api.js)**: Estimating unique visitor client queries.
* 🗂️ **[example/hyperloglog/mysql-cache.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/hyperloglog/mysql-cache.js)**: Tracking unique item access log statistics.
