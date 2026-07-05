# Redis Data Types Specification: Sets

## 1. Overview
Redis Sets are unordered collections of unique strings. If you add the same element to a Set multiple times, it will only store a single copy. Redis Sets allow checking if an element exists in $O(1)$ time, and support server-side mathematical operations such as finding intersections, unions, and differences across multiple sets.

---

## 2. Pros & Cons

### Pros
* **Guaranteed Uniqueness**: Redis automatically handles deduplication, removing the need for application-side filtering.
* **Instant Membership Tests**: Checking if an element exists in a Set (`SISMEMBER`) is a constant-time $O(1)$ operation, regardless of the set size.
* **Fast Set Arithmetic**: Operations like `SINTER` (intersection), `SUNION` (union), and `SDIFF` (difference) are processed natively on the Redis server, saving network overhead.

### Cons
* **No Ordering**: Unlike Lists or Sorted Sets, you cannot retrieve items in a specific order (e.g., sorted by arrival or rank).
* **Memory Overhead**: Large sets encoded as hashtables consume more memory than dense arrays or lists due to bucket pointer overhead.

---

## 3. Under the Hood (How it Works)
Redis Sets use two different internal encodings depending on the data types and volume:

### Intset Encoding
If a Set consists **only** of integers (specifically 64-bit signed integers) and the set size is smaller than the configured `set-max-intset-entries` (default: 512), Redis encodes the set as an **intset**.
* An `intset` is a sorted, compact array of integers.
* Lookup operations on an `intset` use **binary search** ($O(\log N)$).
* This provides extreme memory efficiency at small scales.

### Hashtable Encoding
If the Set contains even one string value, or if its size exceeds the `set-max-intset-entries` limit, Redis automatically converts (upgrades) the encoding to a **Hashtable** (represented by the internal `dict` structure).
* Values are stored as keys in the hash table, and their values are set to `NULL`.
* Lookup is constant-time $O(1)$.

---

## 4. Why, Where, and When

### Why Use Sets?
Use Sets when you need to maintain unique groupings of objects, quickly check if a record belongs to a group, or calculate mutual connections (such as mutual friends, shared interests, or combined permissions).

### Where to Use Sets?
* **Unique Visitor Trackers**: Storing IP addresses or User IDs to track unique site hits.
* **Social Connections**: Tracking "Following" and "Followers".
* **Tagging Systems**: Labeling blog posts, products, or metadata.
* **Access Control Lists (ACL)**: Storing list of permissions or roles assigned to a user.

### When to Use Sets?
* Use Sets when duplicate values are unacceptable.
* Use Sets when check-existence speed is critical.
* Do **not** use Sets if order of insertion or sorting matters (use **Lists** or **Sorted Sets**).

---

## 5. Real-Life Project Use Case: Social Network Friend Recommendations
In a social network, you want to show users "People you might know" based on mutual friends.

### Architecture Flow
1. Every user has a Set of friend IDs: `user:<user_id>:friends`.
2. When Alice (`user:1`) visits Bob's (`user:2`) profile:
   * We display Bob's friends who are **not** currently friends with Alice.
   * We display Alice and Bob's **mutual friends** (intersection).
3. We query these intersections and differences directly using Redis Set commands.

```
Alice's Friends: {2, 3, 4, 5}
Bob's Friends:   {1, 4, 5, 6, 7}

Mutual Friends (Intersection): SINTER Alice Bob -> {4, 5}
Bob's Friends not Alice's (Difference): SDIFF Bob Alice -> {1, 6, 7} (Filter out Alice's own ID -> {6, 7})
```

### Redis CLI Commands
```bash
# Add friends for Alice (User 1)
SADD user:1:friends 2 3 4 5

# Add friends for Bob (User 2)
SADD user:2:friends 1 4 5 6 7

# Get mutual friends
SINTER user:1:friends user:2:friends
# -> Returns: "4", "5"

# Find candidates for Bob to recommend to Alice (friends of Bob who aren't friends with Alice)
SDIFF user:2:friends user:1:friends
# -> Returns: "1", "6", "7" (we ignore "1" because that's Bob himself)
```

### Node.js (`ioredis`) Implementation
```javascript
const redis = require('../client');

// Retrieve mutual friends
async function getMutualFriends(userA, userB) {
    const keyA = `user:${userA}:friends`;
    const keyB = `user:${userB}:friends`;
    
    return await redis.sinter(keyA, keyB);
}

// Generate friend recommendations for Alice based on Bob's friends
async function recommendFriends(targetUser, friendUser) {
    const targetKey = `user:${targetUser}:friends`;
    const friendKey = `user:${friendUser}:friends`;
    
    // Get friends of friendUser who are NOT friends of targetUser
    const candidates = await redis.sdiff(friendKey, targetKey);
    
    // Filter out targetUser themselves from recommendations
    return candidates.filter(id => id !== targetUser.toString());
}

// Usage Example:
// const mutual = await getMutualFriends(1, 2);
// const recommendations = await recommendFriends(1, 2);
```

---

## 🛠️ Practice Exercise Code
Check out the fully functional Express API files in this playground:
* 🗂️ **[example/set/basic.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/set/basic.js)**: Raw Redis Set commands (`SADD`, `SREM`, `SISMEMBER`, `SMEMBERS`, `SINTER`, `SUNION`, `SDIFF`).
* 🗂️ **[example/set/placeholder-api.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/set/placeholder-api.js)**: Tracking unique visited entity categories/tags.
* 🗂️ **[example/set/mysql-cache.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/set/mysql-cache.js)**: Managing and caching user group permissions.
