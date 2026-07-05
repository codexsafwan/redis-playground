const client = require('./client');

async function init() {
    // await client.set('user:1', JSON.stringify({ name: 'John Doe', age: 30 }));
    await client.expire('user:1', 10); // Set expiration time to 10 seconds
    const result = await client.get('user:1');
    console.log("result:", result);
}

init();