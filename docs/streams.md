# Redis Data Types Specification: Streams

## 1. Overview
Redis Streams is an append-only, log-like data structure designed to represent a stream of events. It supports complex message brokerage patterns, including consumer groups, partition-like scaling, message persistence, and consumer confirmations. It acts as a lightweight, high-performance alternative to systems like Apache Kafka.

---

## 2. Pros & Cons

### Pros
* **Consumer Groups**: Multiple consumers can join a group to read disjoint subsets of the stream (competing consumers pattern), allowing horizontal processing scalability.
* **Persistent Event History**: Unlike Pub/Sub, where messages are lost if no subscriber is active, Streams retain messages in memory.
* **At-Least-Once Delivery**: Redis tracks pending messages that were delivered but not acknowledged (`XACK`), allowing workers to reclaim and retry failed messages (`XPENDING`, `XCLAIM`).
* **Capped Size**: You can keep the stream size capped efficiently using the `MAXLEN` or `MINID` modifiers during writes.

### Cons
* **In-Memory Limitations**: Unlike Kafka, which saves data to disk and allows cold-storage retention, Redis Streams are stored in RAM. Large, high-frequency streams will consume significant memory unless aggressively capped.
* **No Dynamic Partitions**: Redis Streams do not support native dynamic partitioning across cluster nodes (partitioning must be handled at the application key level, e.g., using different keys like `stream:1`, `stream:2`).

---

## 3. Under the Hood (How it Works)
Redis Streams are represented internally using a data structure called a **Radix Tree** (implemented as `rax` in Redis source code).

### Radix Tree & Macro Nodes
* A Radix Tree is a space-optimized trie (prefix tree) where nodes that contain a single child are merged with their parent.
* This allows Redis to index the generated stream IDs (e.g. `1719881234567-0`) with very high prefix compression.
* **Macro Nodes**: Instead of allocating a tree node for every single stream entry, Redis groups multiple stream entries together into a single "macro node" containing a compact array of data. This saves pointer overhead and keeps cache-locality high.

---

## 4. Why, Where, and When

### Why Use Streams?
Use Streams when you require a robust message broker with consumer coordination, delivery guarantees, message history, and the ability to process events asynchronously across multiple workers without the operational overhead of running heavy message-broker software.

### Where to Use Streams?
* **Distributed Activity Logs**: Capturing clicks, views, or telemetry events from multiple microservices.
* **Event-Driven Microservices**: Communicating state changes (e.g. `order_created` $\rightarrow$ `inventory_reserved` $\rightarrow$ `payment_processed`).
* **Chat Applications**: Storing and broadcasting message histories to room participants.

### When to Use Streams?
* Use Streams when you have multiple consumers that must process messages in parallel without duplicates.
* Use Streams when you need to guarantee that no message is lost if a worker crashes during execution.
* Do **not** use Streams if you need long-term archival of high-velocity logs (use disk-based logging or databases).
* Do **not** use Streams if simple pub/sub is sufficient and message history is irrelevant (use Redis **Pub/Sub**).

---

## 5. Real-Life Project Use Case: Microservice Order Processing
In an e-commerce platform, when an order is placed, several actions must happen: inventory must be deducted, a notification email must be sent, and a shipping label must be created. We use a Redis Stream to coordinate these tasks.

### Architecture Flow
1. The **Order Service** appends an order event to `stream:orders`.
2. A Consumer Group `group:order_processors` is created.
3. Two separate microservices (**Inventory Service** and **Email Service**) consume events from the stream.
4. When they complete their tasks, they acknowledge the message using `XACK`.

```
[Order Service] ---> XADD stream:orders * order_id 999 amount 59.99
                                  |
                                  v
                       Consumer Group: order_processors
                      /                             \
                     v                               v
            [Inventory Service]                [Email Service]
        (Reads, reserves stock)            (Reads, sends email)
                     |                               |
          XACK stream:orders group...     XACK stream:orders group...
```

### Redis CLI Commands
```bash
# 1. Create a consumer group to start reading from the beginning ('0')
XGROUP CREATE stream:orders group:processors 0 MKSTREAM

# 2. Add an order event to the stream
XADD stream:orders * order_id "999" total "59.99" customer "alice@example.com"
# -> Returns generated ID, e.g., "1719880000000-0"

# 3. Consumer "worker_1" reads new messages (indicated by '>') from the group
XREADGROUP GROUP group:processors worker_1 COUNT 1 STREAMS stream:orders >
# -> Returns: 1) 1) "stream:orders"
#               2) 1) 1) "1719880000000-0"
#                     2) 1) "order_id"  2) "999"  3) "total"  4) "59.99" ...

# 4. Acknowledge that order 999 has been processed
XACK stream:orders group:processors "1719880000000-0"
```

### Node.js (`ioredis`) Implementation
```javascript
const redis = require('../client');

// Initialize Stream and Consumer Group
async function setupStream() {
    try {
        // Create group, MKSTREAM creates the stream key if it doesn't exist
        await redis.xgroup('CREATE', 'stream:orders', 'group:processors', '0', 'MKSTREAM');
    } catch (err) {
        if (!err.message.includes('BUSYGROUP')) {
            throw err; // Ignore if group already exists
        }
    }
}

// Order Producer
async function placeOrder(orderId, total, customerEmail) {
    // Add message and cap stream to latest 10000 items to control memory usage
    const messageId = await redis.xadd(
        'stream:orders', 'MAXLEN', '~', 10000, '*',
        'order_id', orderId,
        'total', total,
        'email', customerEmail
    );
    console.log(`Order event added. Message ID: ${messageId}`);
}

// Order Consumer Worker
async function startConsumer(consumerName) {
    console.log(`Consumer ${consumerName} started.`);
    while (true) {
        try {
            // Read next unread message ('>')
            const result = await redis.xreadgroup(
                'GROUP', 'group:processors', consumerName,
                'COUNT', 1,
                'BLOCK', 2000, // Block up to 2 seconds if no events
                'STREAMS', 'stream:orders', '>'
            );

            if (result) {
                const [streamName, messages] = result[0];
                const [messageId, fieldsArray] = messages[0];
                
                // Parse fields array ['field1', 'val1', 'field2', 'val2'] into an object
                const message = {};
                for (let i = 0; i < fieldsArray.length; i += 2) {
                    message[fieldsArray[i]] = fieldsArray[i+1];
                }
                
                console.log(`[${consumerName}] Processing order ${message.order_id} (Total: $${message.total})`);
                
                // Simulate processing
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Acknowledge event
                await redis.xack('stream:orders', 'group:processors', messageId);
                console.log(`[${consumerName}] Acknowledged message ${messageId}`);
            }
        } catch (error) {
            console.error('Consumer error:', error);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Usage Example:
// await setupStream();
// await placeOrder('999', '59.99', 'alice@example.com');
// startConsumer('order_service_worker_1');
```

---

## 🛠️ Practice Exercise Code
Check out the fully functional Express API files in this playground:
* 🗂️ **[example/stream/basic.js](../example/stream/basic.js)**: Raw Stream commands (`XADD`, `XREAD`, `XRANGE`, `XGROUP`, `XREADGROUP`, `XACK`).
* 🗂️ **[example/stream/placeholder-api.js](../example/stream/placeholder-api.js)**: Log events pipeline for querying external mock endpoints.
* 🗂️ **[example/stream/mysql-cache.js](../example/stream/mysql-cache.js)**: Relational DB mutation streaming and consumer queueing.
