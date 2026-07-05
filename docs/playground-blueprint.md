# Developer Blueprint: Creating 3-File Redis Exercises

This document serves as a step-by-step developer guide on how to build the **3-file API blueprint** for any Redis data type in this playground. You can follow these templates to create matching exercises for **Lists**, **Sets**, **Sorted Sets**, and **Hashes**.

---

## ⚙️ The Centralized Configuration Zone (`config.js`)
To avoid hardcoding port mappings and duplicate database connections in every exercise, the root directory contains a centralized [config.js](../config.js). Every file imports its dependencies and ports from this file.

```javascript
// config.js (Root Level)
const { Redis } = require("ioredis");
const mysql = require("mysql2/promise");

const redis = new Redis();
const mysqlPool = mysql.createPool({ ... });
const PORTS = { basic: 3001, placeholder: 3002, mysql: 3003 };

module.exports = { redis, mysqlPool, PORTS };
```

---

## 🏗️ The 3-File Architecture

For any data type (e.g. `list`, `string`), you will create a subfolder inside the `example/` folder containing exactly three JavaScript files:

```
example/[data-type]/
  ├── basic.js              # File 1: Raw operations API (Express)
  ├── placeholder-api.js    # File 2: External API caching endpoint (Express + Axios)
  └── mysql-cache.js        # File 3: Relational DB caching (Express + MySQL pool)
```

---

## 📝 1. Blueprint for File 1: `basic.js` (Raw Operations API)

### Purpose
Expose Express endpoints that map directly to the native Redis commands of the target data type.

### Structural Blueprint
```javascript
const express = require('express');
const { redis, PORTS } = require('../../config'); // Import centralized configs from root

const app = express();
app.use(express.json());
const PORT = PORTS.basic; // Port managed by config.js

// Endpoint 1: Add/Set data
app.post('/add', async (req, res) => {
    // Call Redis commands like SADD, LPUSH, ZADD, HSET depending on data type
});

// Endpoint 2: Read data
app.get('/get', async (req, res) => {
    // Call Redis commands like SMEMBERS, LRANGE, ZRANGE, HGETALL
});

// Endpoint 3: Update/Modify data
app.put('/update', async (req, res) => {
    // Call Redis commands like ZINCRBY, HINCRBY, LSET
});

// Endpoint 4: Delete data
app.delete('/remove', async (req, res) => {
    // Call Redis commands like SREM, LPOP, ZREM, HDEL
});

app.listen(PORT, () => console.log(`Basic API running on http://localhost:${PORT}`));
```

---

## 📝 2. Blueprint for File 2: `placeholder-api.js` (External API Caching)

### Purpose
Showcase how the target data type can be used to optimize or supplement external REST requests (e.g. JSONPlaceholder).

### Pattern Variations by Data Type

#### 📋 Lists (Tracking Query History)
* **API Goal**: Save the user's latest 5 JSONPlaceholder search queries.
* **Mechanism**: Every time a user fetches `/post/:id`, use `LPUSH` to insert the post title into a history list, followed by `LTRIM` to keep only the latest 5 entries.

#### 🧼 Sets (Tracking Visited Entity IDs)
* **API Goal**: Keep track of unique resources the user has accessed.
* **Mechanism**: When a user queries `/post/:id`, use `SADD visited:posts <id>` to store unique IDs. Use `SMEMBERS` to display the list of unique posts visited.

#### 🏆 Sorted Sets (Ranking Most Viewed Posts)
* **API Goal**: Build a live leaderboard of most viewed posts.
* **Mechanism**: When a user views `/post/:id`, increment its score in a sorted set using `ZINCRBY post:views 1 <id>`. Expose a `/popular` endpoint that returns top posts using `ZREVRANGE`.

#### 🗺️ Hashes (Caching Entity Fields)
* **API Goal**: Cache JSON object details field-by-field.
* **Mechanism**: Store the fetched post payload as field-value pairs in a Redis Hash using `HSET`.

---

## 📝 3. Blueprint for File 3: `mysql-cache.js` (MySQL Database Caching)

### Purpose
Demonstrate the **Cache-Aside** (Read) and **Cache-Invalidation** (Write/Update) lifecycle using a real relational database connection (`redis_play` DB).

### General Flow Diagram
```
              [ GET Request ]
                     |
             Does Cache Exist?
             /               \
          (Yes)              (No)
           /                   \
      [Cache Hit]          [Cache Miss]
     Return Cache        Query MySQL DB
                                |
                        Save in Redis Cache
                                |
                           Return Data
```

### Pattern Variations by Data Type

#### 📋 Lists (Latest DB Audits Log)
* **CRUD Action**: When a new record is created in MySQL, append the event description to a Redis List (`RPUSH logs:audit "User X created at Y"`).
* **Read Action**: Fetch the latest 10 audit logs using `LRANGE logs:audit 0 9`.

#### 🧼 Sets (User Group Permissions)
* **CRUD Action**: When roles are updated in MySQL, invalidate or update the Redis Set of user permissions.
* **Read Action**: Fetch a user's permissions. Cache the permissions in a Redis Set so authorization checks are instant ($O(1)$) using `SISMEMBER`.

#### 🏆 Sorted Sets (Paginated Listing Cache)
* **CRUD Action**: When database items are updated, invalidate the sorted set cache.
* **Read Action**: Query a leaderboard table from MySQL. Store values in a Sorted Set using database IDs as members and prices/timestamps as scores. Serve paginated API endpoints using `ZRANGE`.

#### 🗺️ Hashes (Caching Database Rows)
* **CRUD Action**: When updating a row in MySQL, invalidate the Redis Hash (`DEL user:<id>`) or update specific hash fields (`HSET user:<id> field value`).
* **Read Action**: Query a user row by ID from MySQL. Store all columns inside a Redis Hash (`HSET user:<id> column1 val1 ...`).

---

## 💾 4. Caching "Big Data" Payloads (5,000+ Items)

When dealing with large API payloads (e.g. 5,000 photos or products), caching the raw string can bottleneck Redis memory and increase JSON parsing overhead. You should use one of the following two advanced strategies:

### Strategy A: GZIP Compression (For Large Raw Strings)
If you must cache the entire payload as a single String, compress it using Node's built-in `zlib` library before saving, and decompress it on read. This reduces memory usage by up to **80%**.

```javascript
const zlib = require('zlib');
const util = require('util');
const gzip = util.promisify(zlib.gzip);
const gunzip = util.promisify(zlib.gunzip);

// 1. Caching Gzipped Data
const rawData = JSON.stringify(bigPayload);
const compressed = await gzip(rawData);
await redis.set('big:data:key', compressed.toString('base64'), 'EX', 3600);

// 2. Fetching Gzipped Data
const cachedBase64 = await redis.get('big:data:key');
if (cachedBase64) {
    const buffer = Buffer.from(cachedBase64, 'base64');
    const decompressed = await gunzip(buffer);
    const result = JSON.parse(decompressed.toString());
}
```

### Strategy B: Paginated Cache (Using Hashes & Sorted Sets)
Instead of storing all 5,000 items in a single key, split them:
1. Store each individual entity in a Redis Hash: `product:<id>`.
2. Add the product IDs to a Sorted Set: `products:all` (using the product ID or timestamp as the score).
3. Query only the requested page from Redis.

```javascript
// Serving Page 2 (items 10 to 19)
const start = 10;
const stop = 19;

// Fetch page IDs from Sorted Set
const ids = await redis.zrange('products:all', start, stop);

// Multi-fetch the hashes using pipeline to minimize round-trips
const pipeline = redis.pipeline();
ids.forEach(id => pipeline.hgetall(`product:${id}`));
const products = (await pipeline.exec()).map(res => res[1]);
```

---

## 📮 5. Postman Test Suite Payloads

Use these exact values to configure your requests inside Postman.

### A. Testing `basic.js` (Port 3001)

#### 1. Set key with TTL
* **Method**: `POST`
* **URL**: `http://localhost:3001/set`
* **Headers**: `Content-Type: application/json`
* **Body (raw JSON)**:
  ```json
  {
    "key": "user:profile:name",
    "value": "Safwan",
    "ttl": 120
  }
  ```

#### 2. Get key value
* **Method**: `GET`
* **URL**: `http://localhost:3001/get/user:profile:name`

#### 3. Increment a counter
* **Method**: `POST`
* **URL**: `http://localhost:3001/incr/hits:counter`

---

### B. Testing `placeholder-api.js` (Port 3002)

#### 1. Fetch Post (Cache-Aside check)
* **Method**: `GET`
* **URL**: `http://localhost:3002/post/5`
  * *Note: The first response will return `"source": "Placeholder API"`. Trigger it again within 30 seconds to see `"source": "Redis Cache"`.*

#### 2. Clear Post Cache
* **Method**: `DELETE`
* **URL**: `http://localhost:3002/post/5/cache`

---

### C. Testing `mysql-cache.js` (Port 3003)

#### 1. Create a User in MySQL
* **Method**: `POST`
* **URL**: `http://localhost:3003/users`
* **Headers**: `Content-Type: application/json`
* **Body (raw JSON)**:
  ```json
  {
    "name": "Jane Smith",
    "email": "jane.smith@example.com",
    "role": "editor"
  }
  ```

#### 2. Fetch User Profile (Cache-Aside)
* **Method**: `GET`
* **URL**: `http://localhost:3003/users/1`
  * *Note: First request triggers a DB query logs. Repeated hits serve from Redis.*

#### 3. Update User (Invalidates Cache)
* **Method**: `PUT`
* **URL**: `http://localhost:3003/users/1`
* **Headers**: `Content-Type: application/json`
* **Body (raw JSON)**:
  ```json
  {
    "name": "Jane S. Robinson"
  }
  ```
  * *Note: Running GET after this will hit MySQL again because the cache was invalidated.*

---

## 🚀 Step-by-Step Exercise Checklist

When creating a new data-type practice set, follow this exact workflow:

1. **Verify Services**: Make sure MySQL and Redis are running locally.
2. **Create Folder**: Make a new folder inside the `example/` directory (e.g. `mkdir -p example/list`).
3. **Write `basic.js`**: Implement Express routes for the core operations. Ensure you import the client and port with `const { redis, PORTS } = require('../../config')`.
4. **Write `placeholder-api.js`**: Use `axios` to connect to `https://jsonplaceholder.typicode.com` and use the Redis structure to cache/log calls. Import configs from `../../config`.
5. **Write `mysql-cache.js`**:
   * Import config: `const { redis, mysqlPool, PORTS } = require('../../config')`.
   * Add automated table creation logic in an initialization function using `mysqlPool`.
   * Write REST endpoints for CRUD.
   * Implement Cache-Aside on `GET` and Cache Invalidation on `PUT`/`DELETE`.
6. **Link Docs**: Update the index in `docs/data-types.md` to reference your new files.
