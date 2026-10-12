// LoreForge API server. Local-first: no Stripe, no OAuth, no Redis.
// Set API_KEY in the environment to require an x-api-key header;
// leave it empty for open access on your own network.

import 'dotenv/config'; // must stay the very first import
import express from 'express';
import cors from 'cors';
import connectDB from './db.js';
import apiRoutes from './routes/api.js';
import adminRoutes from './routes/admin.js';
import { requireApiKey, requireAdminKey } from './middleware/auth.js';
import { demoMode } from './middleware/demo.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Hardening for public exposure:
// - no X-Powered-By fingerprinting
// - 'simple' query parser: ?fandom[$ne]=x stays a literal key, so Mongo
//   operator injection via qs-style nesting is impossible
app.disable('x-powered-by');
app.set('query parser', 'simple');

// Minimal security headers (no extra dependency)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

if (!process.env.MONGO_URI) {
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/loreforge';
}

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'loreforge', timestamp: new Date().toISOString() });
});

// Admin routes must mount BEFORE the generic apiRoutes: apiRoutes has
// parameterized paths (/:fandom/:entityType) that would otherwise swallow
// /admin/* requests. Admin has its own key gate (ADMIN_KEY) so the costly
// ingest endpoints stay private even when the public API is open.
app.use('/api/v1/admin', requireAdminKey, adminRoutes);
// demoMode sits after requireApiKey so its X-RateLimit headers (the tighter
// demo budget) are the ones the client sees. Funnel (loopback) traffic gets
// demo restrictions; LAN traffic and admin-key holders pass through untouched.
app.use('/api/v1', requireApiKey, demoMode, apiRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler (must have 4 args to catch errors)
app.use((err, req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`\n========================================`);
        console.log(`🚀 LoreForge API is LIVE!`);
        console.log(`🔗 Base URL: http://localhost:${PORT}/api/v1`);
        console.log(`🔑 Auth: ${process.env.API_KEY ? 'x-api-key required' : 'open (set API_KEY to require a key)'}`);
        console.log(`========================================\n`);
    });
});
