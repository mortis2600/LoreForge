// Smoke test: verifies the API is up and behaving.
// Usage: npm test   (expects the server running on PORT or 3000)

const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`;
const API_KEY = process.env.API_KEY || '';

let failures = 0;

async function check(name, fn) {
    try {
        await fn();
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failures++;
        console.log(`  ❌ ${name}: ${e.message}`);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

const headers = API_KEY ? { 'x-api-key': API_KEY } : {};

await check('GET /health returns ok', async () => {
    const r = await fetch(`${BASE}/health`);
    assert(r.ok, `status ${r.status}`);
    const body = await r.json();
    assert(body.status === 'ok', `unexpected body: ${JSON.stringify(body)}`);
});

await check('GET /api/v1/meta/sources works', async () => {
    const r = await fetch(`${BASE}/api/v1/meta/sources`, { headers });
    assert(r.ok, `status ${r.status}`);
    const body = await r.json();
    assert(Array.isArray(body.sources), 'sources is not an array');
});

await check('unknown route returns 404 JSON', async () => {
    const r = await fetch(`${BASE}/api/v1/nope`, { headers });
    assert(r.status === 404, `status ${r.status}`);
});

await check('regex injection in :name is neutralized', async () => {
    const r = await fetch(`${BASE}/api/v1/dungeon_crawler_carl/characters/.*`, { headers });
    // Must not 500 or dump the collection; 404 (no literal match) is correct.
    assert([404, 400].includes(r.status), `status ${r.status}`);
});

if (failures > 0) {
    console.log(`\n${failures} check(s) failed.`);
    process.exit(1);
}
console.log('\nAll smoke checks passed.');
