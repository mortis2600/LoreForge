// Factory: runs the full pipeline for one source.
//   node src/factory.js <sourceKey> [entityType]
//
// Phase 1: ingest via the source's adapter (list -> fetch -> LLM -> Mongo)
// Phase 2: write a local JSON export snapshot to ./exports/
// Phase 3: generate trivia questions from the ingested data

import 'dotenv/config';
import fs from 'fs';
import connectDB from './db.js';
import Character from './models/Character.js';
import Item from './models/Item.js';
import Spell from './models/Spell.js';
import Location from './models/Location.js';
import Trivia from './models/Trivia.js';
import { runIngest } from './services/ingest.js';
import { generateTriviaBatch } from './services/trivia-generator.js';

const [sourceKey, onlyEntityType] = process.argv.slice(2);
if (!sourceKey) {
    console.error('Usage: node src/factory.js <sourceKey> [entityType]');
    process.exit(1);
}

async function runFactory() {
    await connectDB();
    console.log(`\n========================================`);
    console.log(`🏭 Factory starting pipeline for: ${sourceKey}`);
    console.log(`========================================`);

    console.log(`\n[Phase 1/3] Ingesting source data...`);
    await runIngest(sourceKey, { onlyEntityType: onlyEntityType || null });

    console.log(`\n[Phase 2/3] Writing JSON export snapshot...`);
    const [characters, items, spells, locations] = await Promise.all([
        Character.find({ fandom: sourceKey }).lean(),
        Item.find({ fandom: sourceKey }).lean(),
        Spell.find({ fandom: sourceKey }).lean(),
        Location.find({ fandom: sourceKey }).lean()
    ]);
    const exportPayload = {
        source: sourceKey,
        exported_at: new Date().toISOString(),
        counts: {
            characters: characters.length,
            items: items.length,
            spells: spells.length,
            locations: locations.length
        },
        characters, items, spells, locations
    };
    const exportPath = `./exports/${sourceKey}.json`;
    fs.mkdirSync('./exports', { recursive: true });
    fs.writeFileSync(exportPath, JSON.stringify(exportPayload, null, 2));
    console.log(`💾 Exported to ${exportPath}`);

    console.log(`\n[Phase 3/3] Generating trivia...`);
    await generateTriviaBatch(sourceKey, 100);
    const triviaCount = await Trivia.countDocuments({ fandom: sourceKey });

    console.log(`\n========================================`);
    console.log(`✅ Factory pipeline finished for ${sourceKey}`);
    console.log(`- Characters: ${characters.length}`);
    console.log(`- Items: ${items.length}`);
    console.log(`- Spells: ${spells.length}`);
    console.log(`- Locations: ${locations.length}`);
    console.log(`- Trivia: ${triviaCount}`);
    console.log(`- API: /api/v1/${sourceKey}/*`);
    console.log(`========================================\n`);
}

runFactory()
    .then(() => process.exit(0))
    .catch(e => { console.error('Factory failed:', e.message); process.exit(1); });
