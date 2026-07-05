# Redis Data Types Specification: Bitfields

## 1. Overview
Redis Bitfields allow you to treat a Redis String value as an array of integers of arbitrary bit widths. You can read, write, and increment signed integers up to 64 bits wide, or unsigned integers up to 63 bits wide, at arbitrary bit offsets. It also supports custom policies to handle arithmetic overflows (such as wrapping, saturation, or failing).

---

## 2. Pros & Cons

### Pros
* **Ultimate Packing Efficiency**: Allows packing multiple separate integers into a single string. For example, you can store a user's level (8-bit), quest progress (16-bit), and inventory counts (12-bit) in just 5 bytes of data.
* **Overflow Controls**: You can explicitly control what happens if an increment causes a value to overflow (e.g., locking it at the maximum value rather than wrapping around to negative values).
* **Single Network Trip**: Multiple operations (GET, SET, INCRBY) on different offsets can be executed in a single `BITFIELD` call.

### Cons
* **Lack of Readability**: Because bitfields store dense binary data directly inside standard strings, running `GET` on the key will output binary characters that look like raw/corrupted gibberish in terminal screens.
* **Complex Management**: The developer must manually track bit sizes, alignments, and byte offset math (e.g. knowing that a 12-bit integer starts exactly at bit offset 24). A single misalignment error can corrupt the entire data structure.

---

## 3. Under the Hood (How it Works)
Like Bitmaps, Bitfields leverage the binary-safe **Simple Dynamic Strings (SDS)** representation.

* **Arbitrary Bit Alignments**: Unlike standard CPUs which read memory in 8, 16, 32, or 64-bit aligned boundaries, Redis Bitfields can read values starting at any bit position (e.g., reading a 13-bit integer starting at bit 19).
* **Bitwise Shift Extractors**: To perform `BITFIELD GET u13 #1`, Redis:
  1. Computes the starting byte of the requested bit range.
  2. Loads the adjacent bytes into a temporary 64-bit register.
  3. Uses bitwise shifts (`<<`, `>>`) and bitmasking (`&`) to isolate the 13 bits and returns it to the client as an integer.
* **Overflow Handling Modes**:
  * `WRAP` (default): Standard integer wrap-around (e.g. signed 8-bit `127 + 1` becomes `-128`).
  * `SAT`: Saturation arithmetic. The value stays clamped at its minimum or maximum bound (e.g. signed 8-bit `127 + 1` stays `127`).
  * `FAIL`: Returns `NULL` and aborts the operation if an overflow occurs.

---

## 4. Why, Where, and When

### Why Use Bitfields?
Use Bitfields when you are developing resource-constrained applications (like IoT device hubs or high-scale MMO games) and want to compress data storage to the absolute minimum, matching exact struct bitfields.

### Where to Use Bitfields?
* **Gaming Profile Stats**: Tracking attributes (level, health, armor, status flags) in a single compact key.
* **IoT / Telemetry Sensors**: Packing sensor metrics (temperature, humidity, battery status) in tight binary packages.
* **Compact Checklists**: Storing multi-value state grids.

### When to Use Bitfields?
* Use Bitfields when memory footprint is a critical cost constraint.
* Use Bitfields when you need to increment sub-byte integers atomically.
* Do **not** use Bitfields if readability, easy debugging, or human inspection of data is important (use **Hashes**).
* Do **not** use Bitfields if your programming language lacks solid support for handling binary buffers or parses bit structures differently.

---

## 5. Real-Life Project Use Case: RPG Character Stats Saver
In a massively multiplayer online role-playing game (MMORPG), you want to store a player's character statistics:
* **Level**: Unsigned 8-bit integer (`u8`) - range 0 to 255.
* **Health Points (HP)**: Unsigned 16-bit integer (`u16`) - range 0 to 65,535.
* **Mana Points (MP)**: Unsigned 16-bit integer (`u16`) - range 0 to 65,535.
* **Gold**: Unsigned 32-bit integer (`u32`) - range 0 to 4,294,967,295.

### Layout in Memory
We pack these variables sequentially into a single key `player:101:stats`.
* `u8` (Level) starts at bit offset `0` (or index `#0` for 8-bit boundaries).
* `u16` (HP) starts at bit offset `8` (following the 8-bit Level).
* `u16` (MP) starts at bit offset `24` (8 + 16).
* `u32` (Gold) starts at bit offset `40` (8 + 16 + 16).
* Total size: **9 bytes**!

```
| Level (8 bits) |    HP (16 bits)   |    MP (16 bits)   |        Gold (32 bits)       |
+----------------+-------------------+-------------------+------------------------------+
| Offset 0       | Offset 8          | Offset 24         | Offset 40                    |
```

### Redis CLI Commands
```bash
# Initialize stats: Level 1, HP 100, MP 50, Gold 500
BITFIELD player:101:stats SET u8 0 1 SET u16 8 100 SET u16 24 50 SET u32 40 500

# Fetch all stats
BITFIELD player:101:stats GET u8 0 GET u16 8 GET u16 24 GET u32 40
# -> Returns: 1) 1
#             2) 100
#             3) 50
#             4) 500

# Player earns 1000 gold and gains a level
# We set overflow to SAT for Level so it doesn't wrap around if they hit 255
BITFIELD player:101:stats OVERFLOW SAT INCRBY u8 0 1 INCRBY u32 40 1000
```

### Node.js (`ioredis`) Implementation
```javascript
const redis = require('../client');

// Initialize stats
async function initPlayerStats(playerId, level, hp, mp, gold) {
    const key = `player:${playerId}:stats`;
    await redis.bitfield(
        key,
        'SET', 'u8', 0, level,
        'SET', 'u16', 8, hp,
        'SET', 'u16', 24, mp,
        'SET', 'u32', 40, gold
    );
    console.log(`Stats initialized for player ${playerId}`);
}

// Fetch stats and return them as an object
async function getPlayerStats(playerId) {
    const key = `player:${playerId}:stats`;
    const res = await redis.bitfield(
        key,
        'GET', 'u8', 0,
        'GET', 'u16', 8,
        'GET', 'u16', 24,
        'GET', 'u32', 40
    );
    
    // If key doesn't exist, res might be [0, 0, 0, 0] or empty
    const [level, hp, mp, gold] = res;
    return { level, hp, mp, gold };
}

// Update stats safely (clamped to max/min limits using SAT)
async function modifyStats(playerId, levelDiff, goldDiff) {
    const key = `player:${playerId}:stats`;
    const res = await redis.bitfield(
        key,
        'OVERFLOW', 'SAT',
        'INCRBY', 'u8', 0, levelDiff,
        'INCRBY', 'u32', 40, goldDiff
    );
    
    const [newLevel, newGold] = res;
    console.log(`Updated Player ${playerId}: Level=${newLevel}, Gold=${newGold}`);
}

// Usage Example:
// await initPlayerStats('101', 5, 250, 120, 1500);
// const stats = await getPlayerStats('101');
// await modifyStats('101', 1, 1000);
```

---

## 🛠️ Practice Exercise Code
Check out the fully functional Express API files in this playground:
* 🗂️ **[example/bitfield/basic.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/bitfield/basic.js)**: Raw Bitfield commands (`BITFIELD` get, set, incrby with `OVERFLOW` limits).
* 🗂️ **[example/bitfield/placeholder-api.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/bitfield/placeholder-api.js)**: Storing telemetry status codes in packed bitfields.
* 🗂️ **[example/bitfield/mysql-cache.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/bitfield/mysql-cache.js)**: Binary-efficient database audit flag tracking.
