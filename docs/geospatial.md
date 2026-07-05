# Redis Data Types Specification: Geospatial (GEO)

## 1. Overview
Redis Geospatial (GEO) data structure allows you to store coordinates (longitude and latitude) associated with string members. It provides built-in operations to calculate distances between two points, find locations within a specific radius or bounding box, and query members relative to coordinates.

---

## 2. Pros & Cons

### Pros
* **Fast Proximity Search**: Finding nearest neighbors (`GEOSEARCH`) is fast ($O(\log N + M)$ where $M$ is matches) even with millions of points.
* **Sorted Set Compatibility**: Because GEO coordinates are stored as Sorted Sets internally, you can use Sorted Set commands like `ZREM` to delete locations or `ZCARD` to count them.
* **Low Memory Footprint**: Uses compact Geohash encoding, making it highly memory-efficient.

### Cons
* **No Complex Polygons**: Redis GEO only supports querying inside circular radii or rectangular boxes. It cannot calculate intersections of arbitrary geometric shapes or polygons (unlike PostGIS/MongoDB).
* **Flat Earth Calculations**: Uses the WGS-84 ellipsoid model, assuming the Earth is a perfect sphere for distance calculations. Extremely high-precision mapping applications might experience minor deviations.
* **No Coordinate Updates**: To update coordinates, you must overwrite the member using `GEOADD` again.

---

## 3. Under the Hood (How it Works)
Redis Geospatial data is stored inside a standard **Sorted Set (ZSet)**.

### Geohash Encoding
To represent a 2D coordinate (longitude, latitude) as a 1D scalar score inside a Sorted Set, Redis uses **Geohash** encoding:
1. The Earth is divided into a grid.
2. Longitude and latitude coordinates are converted into binary sequences.
3. The binary sequences of longitude and latitude are interleaved (e.g. `lon0 lat0 lon1 lat1...`) to form a single 52-bit integer.
4. This 52-bit integer is used as the **Sorted Set score** for that member.
5. Due to this encoding, points that are close to each other geographically will have similar Geohash values (scores), enabling fast contiguous range lookups.

---

## 4. Why, Where, and When

### Why Use Geospatial?
Use Geospatial when you need to answer questions like "Where are the closest active drivers?" or "Which branch offices are within 5 miles of this customer?" in real-time, with sub-millisecond response times.

### Where to Use Geospatial?
* **Ride-Hailing / Food Delivery**: Storing and searching active driver/courier locations.
* **Store Locators**: Finding the nearest retail store, ATM, or restaurant.
* **Geofencing**: Detecting when a device enters or leaves a specific circular area.

### When to Use Geospatial?
* Use Geospatial when coordinate updates are frequent and query speeds must be highly optimized.
* Do **not** use Geospatial if you require complex GIS operations, polygon mapping, or spatial joins (use PostgreSQL/PostGIS instead).

---

## 5. Real-Life Project Use Case: Nearby Cab Finder
A ride-sharing app needs to find the top 5 closest available cabs within a 3-kilometer radius of a user's location to dispatch a ride.

### Architecture Flow
1. Cabs periodically report their GPS coordinates to the server.
2. The server updates the cab locations in a Redis GEO key: `cabs:active`.
3. A user requests a ride. The app captures their coordinates (e.g., `-122.4194` longitude, `37.7749` latitude).
4. The server runs `GEOSEARCH` on `cabs:active` looking within 3 km from the user's point, ordered by distance.

```
[Cab reports GPS] ---> GEOADD cabs:active <lon> <lat> <cab_id>
                                 |
                          (User Requests Cab)
                                 v
   GEOSEARCH cabs:active FROMLONLAT <lon> <lat> BYRADIUS 3 km ASC WITHDIST LIMIT 5
```

### Redis CLI Commands
```bash
# Add active cabs coordinates (longitude, latitude, member)
GEOADD cabs:active -122.4089 37.7831 "cab_1"
GEOADD cabs:active -122.4221 37.7682 "cab_2"
GEOADD cabs:active -122.5100 37.7500 "cab_3" # Very far away

# Find 5 closest cabs within 3 km of a user at Union Square (-122.4080, 37.7880)
GEOSEARCH cabs:active FROMLONLAT -122.4080 37.7880 BYRADIUS 3 km ASC WITHDIST LIMIT 5
# -> Returns:
# 1) 1) "cab_1"
#    2) "0.5511" (km)
# 2) 1) "cab_2"
#    2) "2.5410" (km)
# (cab_3 is omitted because it is outside the 3 km radius)
```

### Node.js (`ioredis`) Implementation
```javascript
const redis = require('../client');

// Update driver/cab location
async function updateCabLocation(cabId, longitude, latitude) {
    await redis.geoadd('cabs:active', longitude, latitude, cabId);
    console.log(`Cab ${cabId} location updated.`);
}

// Find closest cabs
async function findNearbyCabs(userLng, userLat, radiusKm = 3, limit = 5) {
    // GEOSEARCH is supported in modern versions of ioredis
    const results = await redis.geosearch(
        'cabs:active',
        'FROMLONLAT', userLng, userLat,
        'BYRADIUS', radiusKm, 'km',
        'ASC',
        'WITHDIST',
        'LIMIT', limit
    );
    
    // Parse results
    // Output format from ioredis: [ ['cab_1', '0.5511'], ['cab_2', '2.5410'] ]
    return results.map(([cabId, dist]) => ({
        cabId,
        distanceKm: parseFloat(dist)
    }));
}

// Remove cab when they go offline
async function removeCab(cabId) {
    // Since GEO is a ZSet, we can use ZREM to remove
    await redis.zrem('cabs:active', cabId);
}

// Usage Example:
// await updateCabLocation('cab_1', -122.4089, 37.7831);
// const nearby = await findNearbyCabs(-122.4080, 37.7880, 3, 5);
```

---

## 🛠️ Practice Exercise Code
Check out the fully functional Express API files in this playground:
* 🗂️ **[example/geospatial/basic.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/geospatial/basic.js)**: Raw Geospatial commands (`GEOADD`, `GEODIST`, `GEOPOS`, `GEOSEARCH`, `ZREM`).
* 🗂️ **[example/geospatial/placeholder-api.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/geospatial/placeholder-api.js)**: Nearby photo-shoot location coordinates search.
* 🗂️ **[example/geospatial/mysql-cache.js](file:///Users/safwan/Documents/work/learn/redis-playground/example/geospatial/mysql-cache.js)**: Proximity checking and caching of retail store branches from database.
