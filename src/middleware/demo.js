// Demo mode: keeps a public demo instance (e.g. behind a Tailscale funnel)
// from being used as a free production API instead of installing LoreForge.
// DEMO_MODE defaults to true; set DEMO_MODE=false to turn it off.
//
// When on, requests arriving via loopback (i.e. through the local funnel
// proxy, which is how this box is exposed) get demo restrictions: a tight
// shared rate limit, reduced page sizes, and an X-Demo-Mode header. LAN
// traffic and requests carrying a valid ADMIN_KEY are never restricted.

import 'dotenv/config';
import { hasValidAdminKey } from './auth.js';

const DEMO_MODE = (process.env.DEMO_MODE || 'true').toLowerCase() === 'true';
const DEMO_MAX = Number(process.env.DEMO_RATE_LIMIT_PER_MINUTE || 30);
const WINDOW_MS = 60 * 1000;

// Single shared bucket: all funnel traffic arrives from loopback, so
// per-IP limiting can't distinguish visitors. This is the point: the demo
// is deliberately tight.
let bucket = { count: 0, resetAt: 0 };

function isLoopback(req) {
    const ip = req.ip || req.socket?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function isDemoMode() {
    return DEMO_MODE;
}

export function demoMode(req, res, next) {
    if (!DEMO_MODE) return next();
    if (hasValidAdminKey(req)) return next();
    if (!isLoopback(req)) return next();

    const now = Date.now();
    if (now > bucket.resetAt) bucket = { count: 0, resetAt: now + WINDOW_MS };
    bucket.count += 1;

    res.setHeader('X-Demo-Mode', 'true');
    res.setHeader('X-RateLimit-Limit', String(DEMO_MAX));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, DEMO_MAX - bucket.count)));

    if (bucket.count > DEMO_MAX) {
        return res.status(429).json({
            error: `Demo rate limit exceeded (${DEMO_MAX} requests/min). ` +
                'Install LoreForge locally for unlimited use: https://github.com/mortis2600/LoreForge'
        });
    }
    req.demo = true;
    next();
}
