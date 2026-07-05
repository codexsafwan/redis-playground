# 🚀 Redis Playground & Learning Guide

Welcome to the **Redis Playground**! This repository is a self-contained learning environment designed to help developers master Redis from the ground up—from basic data types to advanced production-level caching, pipelining, and event streaming architectures.

---

## 📂 Project Architecture & Map

```
redis-playground/
├── config.js                 # ⚙️ Centralized Config (Common DB pools & Port maps)
├── docs/                     # 📚 Detailed concept specifications & designs
│   ├── data-types.md         # Data types overview (Index file)
│   ├── advanced-topics.md    # Lua, transactions, pipelines, and Pub/Sub specs
│   ├── playground-blueprint.md # Architecture pattern guide for exercises
│   └── [type].md             # In-depth specs for each Redis data type
├── example/                  # 🛠️ Executable Express API practice code
│   ├── [type]/               # One folder per Redis data type
│   │   ├── basic.js          # Raw commands endpoints (Port 3001)
│   │   ├── placeholder-api.js# External REST API caching examples (Port 3002)
│   │   └── mysql-cache.js    # MySQL integration with cache-aside/invalidation (Port 3003)
│   └── advanced/             # Advanced feature implementations
│       ├── rate-limiter.js   # Fixed, Sliding, and Lua Token Bucket rate limiters (Port 3004)
│       ├── transactions.js   # Pipeline benchmark & Safe MULTI/EXEC/WATCH credit transfer (Port 3005)
│       └── pubsub.js         # Pub/Sub channels & Keyspace Expiry notifications (Port 3006)
└── client.js                 # Legacy ioredis client exporter
```

---

## 📚 1. Documentation Index

Click on any document below to learn about its properties, Pros & Cons, internal memory layouts, and architectural use cases:

* 🗺️ **[Main Data Types Catalog](docs/data-types.md)**: High-level overview of all structures with access complexity.
* 🛠️ **[Exercise Blueprints](docs/playground-blueprint.md)**: Blueprint specifications for writing clean cached API endpoints.
* 🧠 **[Advanced Guide](docs/advanced-topics.md)**: Guide on atomic Lua scripts, transactions, and pub/sub.

### Type-Specific Specifications:
* 📝 **[Strings](docs/strings.md)** (Simple Dynamic Strings internals & rate limiting case)
* 📋 **[Lists](docs/lists.md)** (Quicklists/Listpacks & task queues)
* 🧼 **[Sets](docs/sets.md)** (Intset/Hashtables & social recommendations)
* 🏆 **[Sorted Sets](docs/sorted-sets.md)** (Skip Lists & delayed jobs queues)
* 🗺️ **[Hashes](docs/hashes.md)** (Memory packing & structured objects)
* 👾 **[Bitmaps](docs/bitmaps.md)** (Bitmask calculations & DAU tracking)
* 📊 **[HyperLogLogs](docs/hyperloglogs.md)** (Probabilistic estimators & view counting)
* 📍 **[Geospatial](docs/geospatial.md)** (Geohashes & nearby cab tracking)
* 🌊 **[Streams](docs/streams.md)** (Radix trees & parallel worker consumer groups)
* 🔢 **[Bitfields](docs/bitfields.md)** (Arbitrary bit boundaries & gamer profiles packing)

---

## 🛠️ 2. Executable Code Directory

Every data type has a dedicated exercise folder containing three Express APIs:

### Strings (`example/string/`)
* 🎂 **[basic.js](example/string/basic.js)**: Raw `SET`, `GET`, `INCR`, `EXPIRE`.
* 🎂 **[placeholder-api.js](example/string/placeholder-api.js)**: Caching posts + **GZIP compression** for big data (5,000 photos).
* 🎂 **[mysql-cache.js](example/string/mysql-cache.js)**: User caching with Cache-Aside read & Cache Invalidation write.

### Lists (`example/list/`)
* 🎂 **[basic.js](example/list/basic.js)**: List pushes, pops, ranges, and trims.
* 🎂 **[placeholder-api.js](example/list/placeholder-api.js)**: Query log history & **Paginated List Cache** for big data.
* 🎂 **[mysql-cache.js](example/list/mysql-cache.js)**: Database audit logger stream.

### Sets (`example/set/`)
* 🎂 **[basic.js](example/set/basic.js)**: Set additions, checks, deletions, and intersections.
* 🎂 **[placeholder-api.js](example/set/placeholder-api.js)**: Tracking unique post authors.
* 🎂 **[mysql-cache.js](example/set/mysql-cache.js)**: User group permissions caching.

### Sorted Sets (`example/sorted-set/`)
* 🎂 **[basic.js](example/sorted-set/basic.js)**: Leaderboards scores, ranks, and updates.
* 🎂 **[placeholder-api.js](example/sorted-set/placeholder-api.js)**: Post views popularity leaderboard.
* 🎂 **[mysql-cache.js](example/sorted-set/mysql-cache.js)**: MySQL game scoreboard Write-Through caching.

### Hashes (`example/hash/`)
* 🎂 **[basic.js](example/hash/basic.js)**: Dynamic key field-value operations.
* 🎂 **[placeholder-api.js](example/hash/placeholder-api.js)**: Granular field-level updates.
* 🎂 **[mysql-cache.js](example/hash/mysql-cache.js)**: Row column-by-column object caching.

### Bitmaps (`example/bitmap/`)
* 🎂 **[basic.js](example/bitmap/basic.js)**: Bit settings, lookups, pops, and bitwise algebra.
* 🎂 **[placeholder-api.js](example/bitmap/placeholder-api.js)**: Compact post visited flags.
* 🎂 **[mysql-cache.js](example/bitmap/mysql-cache.js)**: Daily active user count analytics.

### HyperLogLogs (`example/hyperloglog/`)
* 🎂 **[basic.js](example/hyperloglog/basic.js)**: Probabilistic additions, counts, and merges.
* 🎂 **[placeholder-api.js](example/hyperloglog/placeholder-api.js)**: Approximate unique views estimator.
* 🎂 **[mysql-cache.js](example/hyperloglog/mysql-cache.js)**: Precise vs approximate daily visitor traffic counts.

### Geospatial (`example/geospatial/`)
* 🎂 **[basic.js](example/geospatial/basic.js)**: Geographic coordinate adds, distances, and nearby queries.
* 🎂 **[placeholder-api.js](example/geospatial/placeholder-api.js)**: Local geo-tagged queries.
* 🎂 **[mysql-cache.js](example/geospatial/mysql-cache.js)**: Proximity checking of retail store branches.

### Streams (`example/stream/`)
* 🎂 **[basic.js](example/stream/basic.js)**: Queue creation, reading, and consumer groups.
* 🎂 **[placeholder-api.js](example/stream/placeholder-api.js)**: Stream event logging pipelines.
* 🎂 **[mysql-cache.js](example/stream/mysql-cache.js)**: Database mutations stream with consumer group processor.

### Bitfields (`example/bitfield/`)
* 🎂 **[basic.js](example/bitfield/basic.js)**: Packed bit operations.
* 🎂 **[placeholder-api.js](example/bitfield/placeholder-api.js)**: Packed compact metadata.
* 🎂 **[mysql-cache.js](example/bitfield/mysql-cache.js)**: Highly compressed player statistics caching.

### Advanced Exercises (`example/advanced/`)
* 🎂 **[rate-limiter.js](example/advanced/rate-limiter.js)**: Fixed Window, Sliding Window, and Lua Token Bucket rate limiters.
* 🎂 **[transactions.js](example/advanced/transactions.js)**: Pipeline speed benchmarking & Optimistic Locking balance decr/incr.
* 🎂 **[pubsub.js](example/advanced/pubsub.js)**: Pub/Sub messaging and Real-time Key Expiry listener.

---

## 🚀 3. Getting Started

### 📋 Prerequisites
Ensure you have the following installed and running locally:
1. **Redis Server** (Default port: `6379`)
   * You can install Redis natively or run it easily via **Docker** (see the Docker Setup section below).
2. **MySQL Server** (Default port: `3306` with `root` user and empty password)

### 🐳 Redis Docker Setup Options

#### Option A: Redis Stack (Recommended)
This includes the standard Redis server along with **RedisInsight**, a web GUI for inspecting and debugging cache keys.
```bash
# Start Redis Stack container
docker run -d --name redis-stack -p 6379:6379 -p 8001:8001 redis/redis-stack:latest

# Verify connection via cli inside the container
docker exec -it redis-stack redis-cli ping
# -> Expected response: PONG
```
* **Redis DB URL**: `redis://127.0.0.1:6379`
* **RedisInsight Web GUI URL**: `http://localhost:8001` (Open in browser to see your keys graphically)

#### Option B: Standard Redis (Lightweight)
A standard, minimal Redis server container.
```bash
# Start standard Redis container
docker run -d --name redis-server -p 6379:6379 redis:latest

# Verify connection via cli inside the container
docker exec -it redis-server redis-cli ping
# -> Expected response: PONG
```
* **Redis DB URL**: `redis://127.0.0.1:6379`

#### Useful Docker Control Commands
```bash
# Stop the container
docker stop redis-stack   # Or redis-server

# Start the stopped container again
docker start redis-stack  # Or redis-server

# View live container logs
docker logs -f redis-stack
```

### ⚙️ Database Initialization
On startup, the MySQL examples automatically connect to a database named `redis_play` and create their respective tables. Simply ensure the database exists:
```bash
mysql -uroot -e "CREATE DATABASE IF NOT EXISTS redis_play;"
```

### 💻 Setup
1. Clone this repository.
2. Install package dependencies:
   ```bash
   npm install
   ```

### 🏃 Running Exercises
Run any exercise file by file from the root directory:
```bash
# Example: Run string caching exercise
node example/string/mysql-cache.js
```
Use the curl instructions in **[Exercise Blueprints](docs/playground-blueprint.md)** to test the API endpoints using Postman or CLI tools!
