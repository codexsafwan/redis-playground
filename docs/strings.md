# Redis Data Types Specification: Strings

## 1. Overview
Strings are the most fundamental data type in Redis. They are binary-safe, meaning they can hold any byte sequence—from standard text, JSON payloads, and numbers to serialized files (such as images, compressed archives, or audio). A Redis String key can store up to 512 Megabytes of data.

---

## 2. Pros & Cons

### Pros
* **Simplicity**: Very simple API (`GET`, `SET`) with $O(1)$ operations.
* **Versatility**: Can store any serialized data format (JSON, XML, Protocol Buffers) or binary files.
* **Atomic Numeric Operations**: High-performance operations like `INCR`, `DECR`, `INCRBY` are atomic, making them perfect for concurrency-safe counters and rate limiters.
* **Low Overhead**: Very direct key-value mapping with minimal storage metadata compared to complex nested types.

### Cons
* **Lack of Granularity**: You cannot modify parts of a serialized string (like changing one field inside a cached JSON object) without retrieving, modifying, and writing the entire string back.
* **Memory Inefficiency for Large Payloads**: Storing large, highly structured objects as strings might waste memory due to duplicated key metadata if stored as separate keys, or JSON serialization/deserialization overhead if stored as single values.

---

## 3. Under the Hood (How it Works)
Redis does not use the standard C null-terminated string (`char*`) because it needs to be binary-safe and support $O(1)$ length lookups. Instead, it implements a custom structure called **Simple Dynamic Strings (SDS)**.

### SDS Design:
* **Length header (`len`)**: Stores the current length of the string ($O(1)$ lookup).
* **Capacity header (`alloc`)**: Stores the total allocated buffer size (helps prevent buffer overflow).
* **Flags**: Identifies the SDS type (from SDS 5-bit to 64-bit lengths to minimize header size overhead).
* **Buffer (`buf[]`)**: The actual byte array containing the payload.

### Numeric Optimization:
If the string contains an integer value that fits within a 64-bit signed integer, Redis encodes it internally as an integer (`int` encoding) rather than a raw byte array. This reduces memory footprint and allows direct arithmetic operations without parsing.

---

## 4. Why, Where, and When

### Why Use Strings?
Use strings when you need a simple, high-performance key-value mapping, when your values are atomic/scalar, or when you are caching serialized objects that are read frequently but updated infrequently.

### Where to Use Strings?
* **Shared Session Store**: Storing session data for web servers.
* **Database Query Cache**: Storing expensive SQL/NoSQL query results.
* **Distributed Counters**: Tracking API page views, download counts, and likes.
* **Distributed Locks**: Managing mutual exclusion locks (Redlock pattern).

### When to Use Strings?
* Use strings when the value is read/written as a single unit.
* Do **not** use strings if you need to perform frequent updates to single attributes of a large nested entity (use **Hashes** instead).
* Do **not** use strings if you need to maintain order or perform list-like operations (use **Lists** or **Sorted Sets** instead).

---

## 5. Real-Life Project Use Case: Distributed Rate Limiter
In a microservices architecture, you need to limit the number of API requests a user can make within a given window (e.g., 100 requests per minute) to prevent abuse and API degradation.

### Architecture Flow
1. A request arrives from a user with a unique identifier (e.g., IP address or User ID).
2. The system checks if a rate limit key `rate:limit:<user_id>` exists.
3. If it does not exist, the system sets the key to `1` and applies a 60-second expiration.
4. If it exists, the system increments the value.
5. If the value exceeds the limit (e.g., > 100), the request is rejected with `HTTP 429 Too Many Requests`.

### Redis CLI Commands
```bash
# First request from user_101
EXISTS rate:limit:user_101
# -> Returns 0, so we initialize it:
SET rate:limit:user_101 1 EX 60

# Subsequent requests
INCR rate:limit:user_101
# -> Returns incremented count (e.g., 2, 3, 4...)

# Check current count
GET rate:limit:user_101
```

### Node.js (`ioredis`) Implementation
```javascript
const redis = require('../client');

async function isRateLimited(userId, limit = 100, windowSeconds = 60) {
    const key = `rate:limit:${userId}`;
    
    // We use a Redis transaction (pipeline) to perform operations atomically
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.ttl(key);
    
    const results = await pipeline.exec();
    const currentCount = results[0][1];
    const ttl = results[1][1];
    
    // If the key was just created, set the expiration
    if (currentCount === 1 || ttl === -1) {
        await redis.expire(key, windowSeconds);
    }
    
    if (currentCount > limit) {
        return true; // User is rate limited
    }
    return false; // Request allowed
}

// Usage Example:
// const limited = await isRateLimited('user_101', 5, 10);
```

---

## 🛠️ Practice Exercise Code
Check out the fully functional Express API files in this playground:
* 🗂️ **[example/string/basic.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/string/basic.js)**: Raw Redis String commands (`SET`, `GET`, `INCR`, `EXPIRE`).
* 🗂️ **[example/string/placeholder-api.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/string/placeholder-api.js)**: Caching external placeholders with TTL.
* 🗂️ **[example/string/mysql-cache.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/string/mysql-cache.js)**: Relational DB caching (MySQL + Redis String Cache-Aside and Invalidation).
