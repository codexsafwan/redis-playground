# Redis Data Types Specification: Bitmaps

## 1. Overview
Bitmaps are not a distinct data type in Redis. Instead, they are set of bit-oriented operations defined on the standard String type. Because Redis Strings are binary-safe and can grow up to 512 MB, they can store up to $2^{32}$ (over 4.2 billion) individual bits. Bitmaps allow setting, clearing, and querying individual bits with extreme speed and space efficiency.

---

## 2. Pros & Cons

### Pros
* **Unmatched Space Efficiency**: Storing boolean flags for 4 billion items takes only 512 MB. For 1 million users, tracking daily activity takes only ~125 KB of memory.
* **Server-side Bitwise Algebra**: You can perform high-speed logical operations (`AND`, `OR`, `XOR`, `NOT`) across multiple bitmap keys natively on the Redis server using `BITOP`.
* **Fast Queries**: Lookup (`GETBIT`) and count (`BITCOUNT`) operations are highly optimized $O(1)$ or $O(N)$ (where $N$ is the byte length) calculations.

### Cons
* **Offset Mapping Required**: Bitmaps require integer offsets (e.g. index 0, 1, 2...). If your entity IDs are UUIDs or non-sequential strings, you must maintain a secondary mapping table to translate those string IDs into contiguous integers.
* **Sparse Allocation Penalty**: If you set bit 0 and then set bit 10,000,000, Redis will allocate the entire block of memory in between (~1.2 MB), even if all those intermediate bits are 0. Thus, bitmaps are most efficient when IDs are dense and sequential.

---

## 3. Under the Hood (How it Works)
Because Bitmaps are stored as standard Redis Strings (Simple Dynamic Strings), they inherit SDS memory characteristics:

* **Bit Offsets to Byte Locations**: When you run `SETBIT key 15 1`, Redis computes the byte index using division (`15 / 8 = 1` [byte index 1]) and the bit offset using modulo (`15 % 8 = 7` [the 7th bit of that byte]). It then manipulates that exact bit in memory.
* **Bitcount Optimizations**: To count set bits quickly (`BITCOUNT`), Redis uses a combination of:
  * **Table Lookups**: Pre-computed bitcounts for 8-bit integers (256-entry tables) for small scans.
  * **Variable-Precision SWAR**: A CPU-level parallel bit counting algorithm (bitwise addition) to count bits in 64-bit words, minimizing CPU clock cycles.

---

## 4. Why, Where, and When

### Why Use Bitmaps?
Use Bitmaps when you need to track binary states (yes/no, active/inactive, visited/not visited) for a massive number of elements, and you want to analyze overlaps (e.g. users active on both Monday AND Tuesday) efficiently.

### Where to Use Bitmaps?
* **Daily/Monthly Active Users (DAU/MAU)**: Tracking unique logins.
* **Feature Toggles**: Storing opt-in or subscription status for users.
* **Access Logs**: Recording whether a user has completed a specific step in a checklist.

### When to Use Bitmaps?
* Use Bitmaps when IDs are integers and mostly dense (sequential).
* Use Bitmaps when you need to run logical intersections (e.g., "how many users logged in on Day 1 AND Day 2?").
* Do **not** use Bitmaps if IDs are widely scattered strings/UUIDs (unless you maintain an ID-to-integer mapping).
* Do **not** use Bitmaps if you need to store values other than binary 0 or 1 (use **Hashes** or **Strings**).

---

## 5. Real-Life Project Use Case: Daily Active Users (DAU) & Cohort Retention
An application needs to track which users log in each day and compute user retention statistics (e.g., what percentage of users who logged in on Day 1 also logged in on Day 2).

### Architecture Flow
1. We define a bitmap key for each day: `active:users:YYYY-MM-DD`.
2. The user ID maps directly to the bit offset (e.g., User ID 405 corresponds to bit 405).
3. When User 405 logs in on 2026-07-04, we set bit 405 of `active:users:2026-07-04` to `1`.
4. To find total active users for the day, we run `BITCOUNT`.
5. To find users active on **both** July 4th and July 5th (retention), we run a bitwise `AND` operation into a temporary key and count its bits.

```
active:users:2026-07-04 -> [ Bit 405: 1 ] [ Bit 506: 1 ] [ Bit 800: 0 ]
active:users:2026-07-05 -> [ Bit 405: 1 ] [ Bit 506: 0 ] [ Bit 800: 1 ]

BITOP AND active:both 2026-07-04 2026-07-05
Result -> [ Bit 405: 1 ] [ Bit 506: 0 ] [ Bit 800: 0 ]
BITCOUNT active:both -> 1 (User 405 was active on both days)
```

### Redis CLI Commands
```bash
# Mark users active on Day 1 (July 4th)
SETBIT active:users:2026-07-04 405 1
SETBIT active:users:2026-07-04 506 1

# Mark users active on Day 2 (July 5th)
SETBIT active:users:2026-07-05 405 1
SETBIT active:users:2026-07-05 800 1

# Count active users on Day 1
BITCOUNT active:users:2026-07-04
# -> Returns: 2

# Perform bitwise AND to find users active on both days
BITOP AND active:both active:users:2026-07-04 active:users:2026-07-05

# Count the intersection
BITCOUNT active:both
# -> Returns: 1 (User 405)
```

### Node.js (`ioredis`) Implementation
```javascript
const redis = require('../client');

// Record user activity
async function recordActivity(userId, dateStr) {
    const key = `active:users:${dateStr}`;
    await redis.setbit(key, userId, 1);
}

// Check if user was active on a given date
async function wasUserActive(userId, dateStr) {
    const key = `active:users:${dateStr}`;
    const status = await redis.getbit(key, userId);
    return status === 1;
}

// Compute retention (intersection) count between two dates
async function getRetainedUserCount(dateA, dateB) {
    const keyA = `active:users:${dateA}`;
    const keyB = `active:users:${dateB}`;
    const destKey = `active:intersect:${dateA}:${dateB}`;
    
    // Natively perform intersection and store in destKey
    // Expire the intersection key quickly so it doesn't leak memory
    await redis.pipeline()
        .bitop('AND', destKey, keyA, keyB)
        .bitcount(destKey)
        .expire(destKey, 60) // Keep for 60 seconds
        .exec();
        
    // Execute a separate fetch or parse pipeline results
    const count = await redis.bitcount(destKey);
    return count;
}

// Usage Example:
// await recordActivity(405, '2026-07-04');
// await recordActivity(506, '2026-07-04');
// await recordActivity(405, '2026-07-05');
// const retained = await getRetainedUserCount('2026-07-04', '2026-07-05'); // 1
```

---

## 🛠️ Practice Exercise Code
Check out the fully functional Express API files in this playground:
* 🗂️ **[example/bitmap/basic.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/bitmap/basic.js)**: Raw Bitmap commands (`SETBIT`, `GETBIT`, `BITCOUNT`, `BITOP`).
* 🗂️ **[example/bitmap/placeholder-api.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/bitmap/placeholder-api.js)**: Caching status checks using space-efficient bit masks.
* 🗂️ **[example/bitmap/mysql-cache.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/bitmap/mysql-cache.js)**: Tracking and caching user active status logs.
