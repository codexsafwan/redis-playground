# Redis Data Types Specification: Hashes

## 1. Overview
Redis Hashes are maps between string fields and string values. They represent the classic "dictionary" or "hash map" data structure, making them the most natural way to represent structured data objects (such as a database row or model instance) directly inside Redis.

---

## 2. Pros & Cons

### Pros
* **Memory Efficiency**: Small hashes are stored in highly optimized, compact memory structures. You can store millions of objects in a single Redis instance with very low overhead.
* **Granular Field Access**: You can read, write, or increment individual fields (using `HSET`, `HGET`, `HINCRBY`) without loading the entire object into memory.
* **Structured Grouping**: Helps organize related properties together under a single Redis key rather than scattering them across separate keys.

### Cons
* **No Direct Nesting**: Hash fields and values must be strings. You cannot natively nest another hash or list inside a hash field (unless you serialize it to JSON, which loses field-level operations).
* **No Complex Indexing**: You cannot easily search for hashes based on a field value (e.g., "find all hashes where `status` is `pending`") without building secondary indexes manually using Sets or Sorted Sets.

---

## 3. Under the Hood (How it Works)
Redis Hashes use two different internal representation encodings:

### Listpack / Ziplist Encoding
When a Hash has a small number of elements and small sizes (configured by `hash-max-listpack-entries` [default: 512] and `hash-max-listpack-value` [default: 64 bytes]), Redis stores it in a **listpack** (or **ziplist** in older versions).
* A `listpack` is a single contiguous block of memory containing key-value pairs sequentially (e.g. `[field1, value1, field2, value2]`).
* It eliminates pointers, reducing memory overhead by up to 80% compared to a hashtable.

### Hashtable Encoding
Once the hash grows beyond these thresholds, Redis automatically converts it to a **Hashtable** (`dict`).
* This uses an array of buckets containing linked lists of entries to handle collisions.
* Lookups are $O(1)$ but require significantly more memory due to hash node pointer overhead.

---

## 4. Why, Where, and When

### Why Use Hashes?
Use Hashes when you want to store objects with multiple attributes, and you want the flexibility to read or edit these attributes independently.

### Where to Use Hashes?
* **User Profiles**: Storing username, email, hashed password, role, and last login time.
* **Product Catalog**: Storing details like SKU, name, price, stock, and descriptions.
* **Web Analytics**: Tracking counts of various event types on a specific resource (using `HINCRBY`).

### When to Use Hashes?
* Use Hashes when you represent entities that map directly to objects/structs in your programming language.
* Use Hashes when properties of the object are updated independently.
* Do **not** use Hashes if you need multi-level nested objects (consider using RedisJSON, or flattening/serializing to a String).
* Do **not** use Hashes if you need to query ranges of values (use **Sorted Sets**).

---

## 5. Real-Life Project Use Case: E-Commerce Shopping Cart
In an e-commerce platform, you want to store a user's shopping cart. The cart contains items (product IDs) and their quantities.

### Architecture Flow
1. A cart is represented by the hash key `cart:user:<user_id>`.
2. The hash fields are the product IDs, and the field values are the quantities.
3. When a user adds an item, we increment the quantity using `HINCRBY`.
4. When a user removes an item, we delete the field using `HDEL`.
5. We can retrieve the entire cart using `HGETALL`.

```
Key: cart:user:456
+-------------------+----------+
| Field (Product)   | Value    |
+-------------------+----------+
| prod_101          | 2        |
| prod_202          | 1        |
+-------------------+----------+
```

### Redis CLI Commands
```bash
# Add/Increment 2 quantities of product prod_101 to Alice's (User 456) cart
HINCRBY cart:user:456 "prod_101" 2

# Add 1 quantity of product prod_202
HINCRBY cart:user:456 "prod_202" 1

# Check total quantity of product prod_101
HGET cart:user:456 "prod_101"

# Get all items in Alice's cart
HGETALL cart:user:456
# -> Returns:
# 1) "prod_101"
# 2) "2"
# 3) "prod_202"
# 4) "1"

# Delete product prod_202 from cart
HDEL cart:user:456 "prod_202"
```

### Node.js (`ioredis`) Implementation
```javascript
const redis = require('../client');

// Add item to shopping cart
async function addToCart(userId, productId, quantity) {
    const cartKey = `cart:user:${userId}`;
    // HINCRBY increments if exists, or sets if new
    const newQty = await redis.hincrby(cartKey, productId, quantity);
    console.log(`Product ${productId} quantity in cart: ${newQty}`);
}

// Remove item from cart
async function removeFromCart(userId, productId) {
    const cartKey = `cart:user:${userId}`;
    await redis.hdel(cartKey, productId);
    console.log(`Product ${productId} removed from user ${userId}'s cart`);
}

// Retrieve cart details
async function getCart(userId) {
    const cartKey = `cart:user:${userId}`;
    const items = await redis.hgetall(cartKey);
    
    // Convert string values to numbers for easier application use
    const formattedCart = {};
    for (const [prodId, qtyStr] of Object.entries(items)) {
        formattedCart[prodId] = parseInt(qtyStr, 10);
    }
    return formattedCart;
}

// Usage Example:
// await addToCart('456', 'prod_101', 2);
// await addToCart('456', 'prod_202', 1);
// const myCart = await getCart('456'); // { prod_101: 2, prod_202: 1 }
```

---

## 🛠️ Practice Exercise Code
Check out the fully functional Express API files in this playground:
* 🗂️ **[example/hash/basic.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/hash/basic.js)**: Raw Hash commands (`HSET`, `HGET`, `HGETALL`, `HDEL`, `HEXISTS`, `HMGET`, `HINCRBY`).
* 🗂️ **[example/hash/placeholder-api.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/hash/placeholder-api.js)**: Caching structured JSON Placeholder entities inside Redis Hashes.
* 🗂️ **[example/hash/mysql-cache.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/hash/mysql-cache.js)**: Object caching of MySQL database rows using Redis Hashes.
