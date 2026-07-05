const express = require('express');
const axios = require('axios');

const redis = require('./client');

const app = express();

app.get('/', async (req, res) => {

    const cacheValue = await redis.get('posts');

    if(cacheValue) {
        console.log('Cache hit');
        return res.json(JSON.parse(cacheValue));
    }

    // res.send('Hello World!');
    const url = 'https://jsonplaceholder.typicode.com/posts';
    const {data} = await axios.get(url);

    await redis.set('posts', JSON.stringify(data), 'EX', 10); // Cache for 10 seconds

    return res.json(data);
});

app.listen(3000, () => { 
    console.log('Server is running on port 3000');
});