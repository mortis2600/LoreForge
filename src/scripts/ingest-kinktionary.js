// One-shot ingest: loads data/kinktionary.json into the kinkterms collection.
// Usage: node src/scripts/ingest-kinktionary.js
// Safe to re-run: upserts on the unique term index.

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import KinkTerm from '../models/KinkTerm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', '..', 'data', 'kinktionary.json');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/loreforge';

const terms = JSON.parse(fs.readFileSync(DATA, 'utf8'));
console.log(`Loaded ${terms.length} terms from ${DATA}`);

await mongoose.connect(MONGO_URI);
let upserted = 0;
for (const t of terms) {
    if (!t.term || !t.definition) continue;
    await KinkTerm.updateOne(
        { term: t.term },
        { $set: { definition: t.definition, category: t.category || 'Uncategorized', source: 'kinktionary' } },
        { upsert: true }
    );
    upserted++;
}
const total = await KinkTerm.countDocuments();
console.log(`kinktionary ingest: ${upserted} terms upserted, ${total} total in collection`);
await mongoose.disconnect();
