// Simple auth for a local-first service. If API_KEY is set in the environment,
// requests must carry it as the x-api-key header. If API_KEY is empty, the
// API is open (fine on your own tailnet, your call).
//
// Rate limiting is an in-memory fixed window per key (or per IP when open).
// No Redis, no database lookups: this middleware never blocks server boot.

import 'dotenv/config';

const API_KEY = process.env.API_KEY || '';
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_PER_MINUTE || 100);

// key -> { count, resetAt }
const buckets = new Map();

function checkRateLimit(bucketKey, res) {
    const now = Date.now();
    let bucket = buckets.get(bucketKey);
    if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + WINDOW_MS };
    }
    bucket.count += 1;
    buckets.set(bucketKey, bucket);

    res.setHeader('X-RateLimit-Limit', String(MAX_REQUESTS));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - bucket.count)));

    if (bucket.count > MAX_REQUESTS) {
        res.status(429).json({ error: `Rate limit exceeded. Max ${MAX_REQUESTS} requests per minute.` });
        return false;
    }
    return true;
}

export function requireApiKey(req, res, next) {
    if (API_KEY) {
        const provided = req.headers['x-api-key'];
        if (!provided || provided !== API_KEY) {
            return res.status(401).json({ error: 'Missing or invalid x-api-key header.' });
        }
        if (!checkRateLimit(`key:${provided}`, res)) return;
    } else {
        // Open mode: still rate-limit per IP so one runaway client can't
        // melt the box.
        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        if (!checkRateLimit(`ip:${ip}`, res)) return;
    }
    next();
}

// Periodic cleanup so the map can't grow forever.
setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
        if (now > b.resetAt) buckets.delete(k);
    }
}, 5 * 60 * 1000).unref();
