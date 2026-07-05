const { Redis } = require("ioredis");
const mysql = require("mysql2/promise");

// 1. Common Redis Client Instance
const redis = new Redis({
    host: '127.0.0.1',
    port: 6379
});

// 2. Common MySQL Connection Pool Instance
const mysqlPool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '', // Empty password for standard Homebrew installation
    database: 'redis_play',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// 3. Common Port Mapping Zone
// This ensures ports remain consistent across all data type exercises
const PORTS = {
    basic: 3001,       // For basic.js
    placeholder: 3002, // For placeholder-api.js
    mysql: 3003,       // For mysql-cache.js
    rateLimiter: 3004, // For rate-limiter.js
    transactions: 3005, // For transactions.js
    pubsub: 3006       // For pubsub.js
};

module.exports = {
    redis,
    mysqlPool,
    PORTS
};
