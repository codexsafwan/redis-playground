const express = require('express');
const { redis, PORTS } = require('../../config');

const app = express();
app.use(express.json());

const PORT = PORTS.basic;

// 1. BITFIELD - Arbitrary bitwise operations with overflow control
// POST http://localhost:3001/bitfield
app.post('/bitfield', async (req, res) => {
    const { key, operations, overflow } = req.body;
    
    if (!key || !operations || !Array.isArray(operations)) {
        return res.status(400).json({ error: 'Key and operations (array of objects) are required' });
    }
    
    try {
        const args = [];
        
        // Handle overflow policy if provided
        if (overflow) {
            const ov = overflow.toUpperCase();
            if (!['WRAP', 'SAT', 'FAIL'].includes(ov)) {
                return res.status(400).json({ error: 'Overflow must be WRAP, SAT, or FAIL' });
            }
            args.push('OVERFLOW', ov);
        }
        
        // Construct bitfield arguments: ['SET', 'u8', '#0', 10, 'INCRBY', 'u16', '#1', 100]
        operations.forEach(op => {
            args.push(op.op.toUpperCase()); // e.g. GET, SET, INCRBY
            args.push(op.type);            // e.g. u8, i16, u32
            args.push(op.offset);          // e.g. 0, #1, 16
            
            if (op.value !== undefined) {
                args.push(parseInt(op.value, 10));
            }
        });
        
        const results = await redis.bitfield(key, ...args);
        return res.json({ message: 'Bitfield operations completed successfully', results });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Basic Bitfields API running on http://localhost:${PORT}`);
});
