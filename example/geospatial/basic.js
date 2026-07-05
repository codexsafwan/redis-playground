const express = require('express');
const { redis, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.basic;

// 1. GEOADD - Add location coordinates
// POST http://localhost:3001/geoadd
app.post('/geoadd', async (req, res) => {
    const { key, longitude, latitude, member } = req.body;
    
    if (!key || longitude === undefined || latitude === undefined || !member) {
        return res.status(400).json({ error: 'Key, longitude, latitude, and member name are required' });
    }
    
    try {
        const added = await redis.geoadd(key, parseFloat(longitude), parseFloat(latitude), member);
        return res.json({ message: `Successfully added member "${member}" location`, addedCount: added });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 2. GEODIST - Calculate distance between two members
// GET http://localhost:3001/geodist?key=places&m1=SanFrancisco&m2=MountainView&unit=km
app.get('/geodist', async (req, res) => {
    const { key, m1, m2, unit } = req.query;
    
    if (!key || !m1 || !m2) {
        return res.status(400).json({ error: 'Query parameters "key", "m1" (member 1), and "m2" (member 2) are required' });
    }
    
    try {
        const distance = await redis.geodist(key, m1, m2, unit || 'km');
        if (distance === null) {
            return res.status(404).json({ error: 'Could not calculate distance. Verify that both members exist in the key.' });
        }
        return res.json({ key, member1: m1, member2: m2, distance: parseFloat(distance), unit: unit || 'km' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 3. GEOPOS - Get coordinates of members
// GET http://localhost:3001/geopos/places/SanFrancisco
app.get('/geopos/:key/:member', async (req, res) => {
    const { key, member } = req.params;
    
    try {
        const pos = await redis.geopos(key, member);
        if (!pos || !pos[0]) {
            return res.status(404).json({ error: `Member "${member}" not found in geospatial key "${key}"` });
        }
        
        const [longitude, latitude] = pos[0];
        return res.json({ key, member, coordinates: { longitude: parseFloat(longitude), latitude: parseFloat(latitude) } });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// 4. GEOSEARCH - Query members in a radius/boundary
// GET http://localhost:3001/geosearch?key=places&lon=-122.40&lat=37.78&radius=10&unit=km
app.get('/geosearch', async (req, res) => {
    const { key, lon, lat, radius, unit } = req.query;
    
    if (!key || lon === undefined || lat === undefined || radius === undefined) {
        return res.status(400).json({ error: 'Parameters "key", "lon", "lat", and "radius" are required' });
    }
    
    try {
        const results = await redis.geosearch(
            key,
            'FROMLONLAT', parseFloat(lon), parseFloat(lat),
            'BYRADIUS', parseFloat(radius), unit || 'km',
            'ASC',
            'WITHDIST',
            'WITHCOORD'
        );
        
        const matches = results.map(([member, dist, [lng, ltd]]) => ({
            member,
            distance: parseFloat(dist),
            unit: unit || 'km',
            coordinates: { longitude: parseFloat(lng), latitude: parseFloat(ltd) }
        }));
        
        return res.json({ key, count: matches.length, matches });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Basic Geospatial API running on http://localhost:${PORT}`);
});
