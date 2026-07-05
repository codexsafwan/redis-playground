# Redis Data Types: Description & Examples

Redis is an in-memory, key-value data store. While keys are always strings, the values associated with them can belong to various data structures. Below is a comprehensive guide to all core Redis data types, complete with detailed descriptions, use cases, complexity, and examples.

### 📚 Detailed Specifications
Click on any data type below to view its comprehensive specification (including Pros/Cons, Internals, Why/Where/When, and a real-world project architecture):
* 📝 **[Strings Spec](file:///Users/safwan/Documents/work/learn/redis-playground/docs/strings.md)**
* 📋 **[Lists Spec](file:///Users/safwan/Documents/work/learn/redis-playground/docs/lists.md)**
* 🧼 **[Sets Spec](file:///Users/safwan/Documents/work/learn/redis-playground/docs/sets.md)**
* 🏆 **[Sorted Sets Spec](file:///Users/safwan/Documents/work/learn/redis-playground/docs/sorted-sets.md)**
* 🗺️ **[Hashes Spec](file:///Users/safwan/Documents/work/learn/redis-playground/docs/hashes.md)**
* 👾 **[Bitmaps Spec](file:///Users/safwan/Documents/work/learn/redis-playground/docs/bitmaps.md)**
* 📊 **[HyperLogLogs Spec](file:///Users/safwan/Documents/work/learn/redis-playground/docs/hyperloglogs.md)**
* 📍 **[Geospatial Spec](file:///Users/safwan/Documents/work/learn/redis-playground/docs/geospatial.md)**
* 🌊 **[Streams Spec](file:///Users/safwan/Documents/work/learn/redis-playground/docs/streams.md)**
* 🔢 **[Bitfields Spec](file:///Users/safwan/Documents/work/learn/redis-playground/docs/bitfields.md)**

### 🚀 Advanced Topics & Algorithms
* 🧠 **[Rate Limiting, Lua Scripting, Transactions & Pub/Sub Spec](file:///Users/safwan/Documents/work/learn/redis-playground/docs/advanced-topics.md)**

### 🏗️ Practical Exercise Blueprints
* 🛠️ **[Developer Blueprint: Creating 3-File Exercise Sets](file:///Users/safwan/Documents/work/learn/redis-playground/docs/playground-blueprint.md)**

---

## 1. Strings
Strings are the most basic Redis data type. They are binary-safe, meaning they can contain any kind of data—from text and numbers to serialized JSON objects or raw binary data like images (up to 512 MB).

### Use Cases
* Caching text, HTML pages, or API responses.
* Session tokens and user authentication states.
* Counters and rate limiters.

### Key Operations & Time Complexity
* `SET` / `GET`: Set/get string value ($O(1)$)
* `INCR` / `DECR`: Increment/decrement an integer counter ($O(1)$)
* `EXPIRE`: Set a time-to-live (TTL) on a key ($O(1)$)

### Examples

#### Redis CLI
```bash
# Set a value with a 60-second expiration
SET session:token "xyz123" EX 60

# Retrieve the value
GET session:token

# Increment a page view counter
INCR page_views
```

#### Node.js (`ioredis`)
```javascript
const redis = require('./client');

async function stringDemo() {
    // Save a serialized object
    await redis.set('user:100', JSON.stringify({ name: 'Alice', role: 'admin' }), 'EX', 3600);
    
    // Retrieve and parse
    const user = await redis.get('user:100');
    console.log(JSON.parse(user)); // { name: 'Alice', role: 'admin' }

    // Atomic increment
    const views = await redis.incr('page_views');
    console.log(`Page views: ${views}`);
}
```

---

## 2. Lists
Redis Lists are lists of strings sorted by insertion order. They are implemented as **doubly-linked lists**, which makes adding elements to the head or tail extremely fast, but finding elements in the middle of a list slow.

### Use Cases
* Message queues (using Producer/Consumer pattern).
* Storing the latest updates or history log (e.g., recent user activity feed).
* Task lists.

### Key Operations & Time Complexity
* `LPUSH` / `RPUSH`: Prepend/Append elements ($O(1)$ per element)
* `LPOP` / `RPOP`: Remove and return elements from left/right ($O(1)$)
* `LRANGE`: Retrieve a range of elements ($O(S+N)$ where $S$ is offset, $N$ is range length)
* `LLEN`: Get list length ($O(1)$)

### Examples

#### Redis CLI
```bash
# Add tasks to a queue
RPUSH task_queue "send_welcome_email"
RPUSH task_queue "generate_invoice"

# Fetch all tasks in the queue
LRANGE task_queue 0 -1

# Process a task (remove from the left)
LPOP task_queue
```

#### Node.js (`ioredis`)
```javascript
const redis = require('./client');

async function listDemo() {
    // Push messages onto the queue
    await redis.rpush('notifications', 'welcome_email', 'monthly_report');
    
    // Fetch all items
    const notifications = await redis.lrange('notifications', 0, -1);
    console.log('Pending notifications:', notifications);

    // Consume item
    const nextNotification = await redis.lpop('notifications');
    console.log('Processing:', nextNotification);
}
```

---

## 3. Sets
Redis Sets are unordered collections of unique strings. Redis does not allow duplicate values inside a Set. Sets also support fast set operations like unions, intersections, and differences.

### Use Cases
* Tracking unique visitors (e.g., unique IPs visiting a page).
* Tagging systems (e.g., articles tagged with "tech", "news").
* Social graphs (e.g., "following" lists or "friend list intersection" for recommendations).

### Key Operations & Time Complexity
* `SADD`: Add one or more members ($O(1)$ per member)
* `SISMEMBER`: Test if a member exists in the set ($O(1)$)
* `SREM`: Remove members ($O(1)$ per member)
* `SINTER` / `SUNION` / `SDIFF`: Intersect/Union/Difference of multiple sets ($O(N \times M)$)

### Examples

#### Redis CLI
```bash
# Add tags to a post
SADD tags:post:1 "javascript" "redis" "backend"

# Check if a tag exists
SISMEMBER tags:post:1 "redis"

# Find tags in common between two posts
SADD tags:post:2 "python" "redis" "backend"
SINTER tags:post:1 tags:post:2
```

#### Node.js (`ioredis`)
```javascript
const redis = require('./client');

async function setDemo() {
    // Add unique users to the online users set
    await redis.sadd('online_users', 'user_1', 'user_2', 'user_3');
    await redis.sadd('online_users', 'user_1'); // Duplicate, ignored

    // Check membership
    const isOnline = await redis.sismember('online_users', 'user_2');
    console.log('Is user_2 online?', isOnline === 1);

    // Get all online users
    const users = await redis.smembers('online_users');
    console.log('Online users:', users);
}
```

---

## 4. Sorted Sets (ZSets)
Sorted Sets are similar to Sets (unordered collection of unique strings), but every member is associated with a floating-point **score**. The members are always sorted by their score (lowest to highest). If scores are identical, members are sorted lexicographically.

### Use Cases
* Leaderboards (e.g., game high scores).
* Rate limiters (using a sliding-window algorithm).
* Priority queues where tasks have priority weights.

### Key Operations & Time Complexity
* `ZADD`: Add members with a score ($O(\log N)$)
* `ZRANGE` / `ZREVRANGE`: Retrieve members sorted in ascending/descending order ($O(\log(N) + M)$)
* `ZREM`: Remove members ($O(\log N)$)
* `ZSCORE`: Get the score of a member ($O(1)$)

### Examples

#### Redis CLI
```bash
# Add players to a high score leaderboard
ZADD game_leaderboard 2500 "PlayerAlpha"
ZADD game_leaderboard 5000 "PlayerBeta"
ZADD game_leaderboard 1200 "PlayerGamma"

# Get top 2 players with scores
ZREVRANGE game_leaderboard 0 1 WITHSCORES
```

#### Node.js (`ioredis`)
```javascript
const redis = require('./client');

async function zsetDemo() {
    // Add members with scores
    await redis.zadd('leaderboard', 3500, 'UserA', 4200, 'UserB', 1500, 'UserC');

    // Get ranked list in descending order
    const topScores = await redis.zrevrange('leaderboard', 0, -1, 'WITHSCORES');
    console.log('Leaderboard:', topScores); 
    // Output format: ['UserB', '4200', 'UserA', '3500', 'UserC', '1500']
}
```

---

## 5. Hashes
Hashes are maps of field-value pairs where both fields and values are strings. This is the perfect representation for structured records, acting like object dictionaries.

### Use Cases
* Representing objects (e.g., user profiles, product catalogs, settings).
* Storing configurations or meta-data.

### Key Operations & Time Complexity
* `HSET` / `HGET`: Set/get the value of a hash field ($O(1)$)
* `HMGET`: Get values of multiple fields ($O(N)$ fields)
* `HGETALL`: Get all fields and values in a hash ($O(N)$ size of hash)
* `HDEL`: Delete one or more fields ($O(1)$ per field)

### Examples

#### Redis CLI
```bash
# Create user profile hash
HSET user:101 username "john_doe" email "john@example.com" age 30

# Retrieve specific fields
HGET user:101 email

# Get entire object
HGETALL user:101
```

#### Node.js (`ioredis`)
```javascript
const redis = require('./client');

async function hashDemo() {
    // Set field values
    await redis.hset('profile:101', {
        name: 'John Doe',
        email: 'john@example.com',
        role: 'user'
    });

    // Fetch individual fields
    const email = await redis.hget('profile:101', 'email');
    console.log('Email:', email);

    // Fetch the entire object
    const profile = await redis.hgetall('profile:101');
    console.log('Profile details:', profile); // { name: 'John Doe', email: '...', role: '...' }
}
```

---

## 6. Bitmaps
Bitmaps are not a standalone data type, but a set of bit-oriented operations defined on the String type. Since a string can be up to 512 MB, it translates to $2^{32}$ individual bits. Bitmaps are incredibly space-efficient for boolean tracking.

### Use Cases
* Daily active users (DAU) analytics (bit index represents user ID, bit value represents active status).
* Simple feature flags/toggles.

### Key Operations & Time Complexity
* `SETBIT`: Set a bit to 0 or 1 ($O(1)$)
* `GETBIT`: Get a bit's value ($O(1)$)
* `BITCOUNT`: Count set bits (population count) ($O(N)$ string size)
* `BITOP`: Bitwise operations (AND, OR, XOR, NOT) across multiple strings ($O(N)$)

### Examples

#### Redis CLI
```bash
# Mark user 55 as active on day 2026-07-04 (bit index 55 set to 1)
SETBIT active_users:2026-07-04 55 1

# Check if user 55 was active
GETBIT active_users:2026-07-04 55

# Count total active users on that day
BITCOUNT active_users:2026-07-04
```

#### Node.js (`ioredis`)
```javascript
const redis = require('./client');

async function bitmapDemo() {
    const key = 'active_users:2026-07-04';
    
    // Set active status for users
    await redis.setbit(key, 1024, 1); // User 1024 is active
    await redis.setbit(key, 2048, 1); // User 2048 is active

    const user1024Active = await redis.getbit(key, 1024);
    const user500Active = await redis.getbit(key, 500);

    console.log('User 1024 active:', user1024Active === 1); // true
    console.log('User 500 active:', user500Active === 1);   // false

    const totalActive = await redis.bitcount(key);
    console.log('Total active users:', totalActive); // 2
}
```

---

## 7. HyperLogLogs (HLL)
HyperLogLogs are a probabilistic data structure used to estimate the cardinality (number of unique elements) of a set. Instead of storing the actual items, HLL uses a fixed memory footprint of 12 KB, providing an estimated count with standard error of 0.81%.

### Use Cases
* Estimating unique searches, page views, or IP visits when exact numbers aren't necessary.
* Counting unique visitors to a website per day/month.

### Key Operations & Time Complexity
* `PFADD`: Add elements to the HLL ($O(1)$)
* `PFCOUNT`: Get estimated cardinality ($O(1)$ for cached estimator, $O(N)$ for merged keys)
* `PFMERGE`: Merge multiple HLLs into one ($O(N)$ where $N$ is number of keys)

### Examples

#### Redis CLI
```bash
# Add visited IP addresses
PFADD unique_visitors:home "192.168.1.1" "10.0.0.1" "192.168.1.1"

# Get estimated unique visitor count
PFCOUNT unique_visitors:home
```

#### Node.js (`ioredis`)
```javascript
const redis = require('./client');

async function hllDemo() {
    // Add unique entries
    await redis.pfadd('unique_ips:blog_1', '192.168.0.1', '192.168.0.2', '192.168.0.1');

    // Fetch estimation
    const count = await redis.pfcount('unique_ips:blog_1');
    console.log('Estimated unique IP count:', count); // 2
}
```

---

## 8. Geospatial (GEO)
Redis Geospatial indexes store longitude and latitude coordinates as a Sorted Set internally (using Geohash encoding). They allow querying items within a certain distance or radius.

### Use Cases
* Ridesharing apps (finding nearby drivers).
* Food delivery/dating apps (finding venues or users nearby).
* Route planning and distance calculation.

### Key Operations & Time Complexity
* `GEOADD`: Add location coordinates ($O(\log N)$)
* `GEODIST`: Calculate distance between two locations ($O(\log N)$)
* `GEOSEARCH`: Query locations inside a radius/box ($O(\log N + M)$ where $M$ is matches)

### Examples

#### Redis CLI
```bash
# Add location of cities
GEOADD locations -122.4194 37.7749 "San Francisco" -122.0841 37.3861 "Mountain View"

# Find distance in kilometers
GEODIST locations "San Francisco" "Mountain View" km

# Find locations within 50 km of San Francisco
GEOSEARCH locations FROMMEMBER "San Francisco" BYRADIUS 50 km WITHDIST
```

#### Node.js (`ioredis`)
```javascript
const redis = require('./client');

async function geoDemo() {
    // Add points
    await redis.geoadd('cities', -122.4194, 37.7749, 'San Francisco', -122.0841, 37.3861, 'Mountain View');

    // Retrieve distance
    const dist = await redis.geodist('cities', 'San Francisco', 'Mountain View', 'km');
    console.log(`Distance: ${dist} km`);

    // Search nearby
    const nearby = await redis.geosearch(
        'cities',
        'FROMMEMBER', 'San Francisco',
        'BYRADIUS', 50, 'km',
        'WITHDIST'
    );
    console.log('Nearby places:', nearby);
}
```

---

## 9. Streams
Streams act like append-only logs. A stream can support multiple Consumer Groups, which coordinate to consume disjoint partitions of data, keeping track of who processed what.

### Use Cases
* Message queues with complex consumer routing/acknowledgments.
* Activity logs or audit trails.
* Real-time chat servers or event-sourcing systems.

### Key Operations & Time Complexity
* `XADD`: Append an entry to a stream ($O(1)$)
* `XRANGE`: Query range of entries ($O(\log N + M)$)
* `XREAD`: Read new entries from stream ($O(\log N + M)$)
* `XGROUP`: Create/manage consumer groups ($O(1)$)
* `XACK`: Acknowledge processing of a message ($O(1)$)

### Examples

#### Redis CLI
```bash
# Add message to stream (* auto-generates timestamp ID)
XADD telemetry * sensor_id "A1" temperature "22.5"

# Read messages starting from ID 0-0
XRANGE telemetry - +
```

#### Node.js (`ioredis`)
```javascript
const redis = require('./client');

async function streamDemo() {
    // Add event
    const messageId = await redis.xadd('sensor_stream', '*', 'device_id', 'dev_42', 'temp', '36.6');
    console.log('Generated stream ID:', messageId);

    // Read events
    const stream = await redis.xread('STREAMS', 'sensor_stream', '0');
    console.log('Stream entries:', JSON.stringify(stream, null, 2));
}
```

---

## 10. Bitfields
Bitfields allow arbitrary bit width operations on key values. You can treat string values as a bitwise array of integers, manipulating signed or unsigned integers of specific bit widths (e.g. 5-bit, 17-bit, etc.).

### Use Cases
* Game state management (saving bytes by packaging multiple stats in a single binary string).
* Space-saving custom counters.

### Key Operations & Time Complexity
* `BITFIELD`: Perform GET, SET, INCRBY on specific offsets ($O(1)$)

### Examples

#### Redis CLI
```bash
# Set an unsigned 8-bit integer at offset 0 to 99, and increment it by 1
BITFIELD player:stats SET u8 #0 99 INCRBY u8 #0 1
```

#### Node.js (`ioredis`)
```javascript
const redis = require('./client');

async function bitfieldDemo() {
    // Set 8-bit unsigned integer at offset 0 to 50, and 16-bit unsigned at offset 1 to 200
    const res = await redis.bitfield('player:100:stats', 'SET', 'u8', '#0', 50, 'SET', 'u16', '#1', 200);
    console.log('Previous values:', res);

    const values = await redis.bitfield('player:100:stats', 'GET', 'u8', '#0', 'GET', 'u16', '#1');
    console.log('Retrieved values:', values); // [50, 200]
}
```

---

## Summary Comparison Table

| Data Type | Ordering | Duplicates Allowed? | Common Use Case | Complexity (Access) |
| :--- | :--- | :--- | :--- | :--- |
| **Strings** | N/A | N/A | Simple cache, counter | $O(1)$ |
| **Lists** | Insertion Order | Yes | Queue, activity feed | $O(N)$ (index), $O(1)$ (head/tail) |
| **Sets** | Unordered | No | Unique count, tag checks | $O(1)$ |
| **Sorted Sets** | Score Order | No | Leaderboards, rate limiting | $O(\log N)$ |
| **Hashes** | Unordered | N/A (unique fields) | Objects, profiles | $O(1)$ |
| **Bitmaps** | Bit Index | N/A | Yes/No activity logs | $O(1)$ |
| **HyperLogLogs**| Unordered | No (compacted) | Cardinality estimation | $O(1)$ (estimation) |
| **Geospatial** | Geo coordinates | No | Location search | $O(\log N + M)$ |
| **Streams** | Time Order | Yes | Message Queue, event log | $O(\log N + M)$ |

---

## 🚀 Next Steps: Advanced Redis
Ready to dive deeper? Check out the **[Advanced Redis Guide](file:///Users/safwan/Documents/work/learn/redis-playground/docs/advanced-topics.md)** to learn about:
* **Advanced Rate Limiting Algorithms** (Fixed Window vs. Sliding Window Log vs. Token Bucket)
* **Atomic execution with Lua Scripting** (preventing race conditions)
* **Pipelining and Transactions** (`MULTI`/`EXEC`/`WATCH`)
* **Real-time Event Processing** (Pub/Sub & Keyspace Notifications)
