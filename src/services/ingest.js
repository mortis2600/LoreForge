// Generic ingest orchestrator. Reads config/sources.json, picks the right
// site adapter per source, and runs: list -> fetch -> LLM structure -> Mongo.
//
// Usage:
//   node src/services/ingest.js <sourceKey> [entityType]
//
// Sources already in the DB are skipped (token saver). For HTML sources the
// title isn't known until fetch time, so dedupe happens post-extraction.

import 'dotenv/config';
import fs from 'fs';
import connectDB from '../db.js';
import { getAdapter } from '../adapters/index.js';
import { extractEntityJSON } from './extract.js';
import Character from '../models/Character.js';
import Item from '../models/Item.js';
import Spell from '../models/Spell.js';
import Location from '../models/Location.js';

const MODELS = {
    characters: Character,
    items: Item,
    spells: Spell,
    locations: Location
};

export const SCHEMAS = {
    characters: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            species: { type: 'string' },
            affiliations: { type: 'array', items: { type: 'string' } },
            status: { type: 'string' }
        },
        required: ['name', 'description']
    },
    items: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            type: { type: 'string' },
            description: { type: 'string' }
        },
        required: ['name', 'description']
    },
    spells: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            school: { type: 'string' },
            description: { type: 'string' }
        },
        required: ['name', 'description']
    },
    locations: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            region: { type: 'string' },
            description: { type: 'string' }
        },
        required: ['name', 'description']
    }
};

export const SOURCES_PATH = './config/sources.json';

export function loadSources() {
    return JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
}

export function saveSources(sources) {
    fs.writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2));
}

export async function runIngest(sourceKey, { onlyEntityType = null } = {}) {
    const sources = loadSources();
    const source = sources[sourceKey];
    if (!source) throw new Error(`Unknown source: ${sourceKey}`);

    const adapter = getAdapter(source.adapter || 'mediawiki');
    const displayName = source.display_name || sourceKey;

    await connectDB();

    const entityTypes = Object.keys(source.categories || source.entity_types || { characters: true });
    for (const entityType of entityTypes) {
        if (onlyEntityType && entityType !== onlyEntityType) continue;
        const TargetModel = MODELS[entityType] || Character;

        console.log(`\n📂 [${sourceKey}] listing ${entityType} via "${adapter.name}" adapter...`);
        const { items, patchedCategory } = await adapter.listItems(source, entityType);

        if (patchedCategory) {
            source.categories[entityType] = patchedCategory;
            sources[sourceKey] = source;
            saveSources(sources);
            console.log(`💾 Auto-patched ${SOURCES_PATH} with working category.`);
        }

        console.log(`🚀 Extracting ${items.length} ${entityType}...\n`);

        for (const item of items) {
            // Token saver: skip anything already in the DB (title known up front).
            if (item.title) {
                const existing = await TargetModel.findOne({ fandom: sourceKey, name: item.title });
                if (existing) {
                    console.log(`⏩ Skipping ${item.title} (already in database)`);
                    continue;
                }
            }

            let fetched;
            try {
                fetched = await adapter.fetchItem(source, item);
            } catch (e) {
                console.error(`⚠️ Fetch failed for ${item.ref}: ${e.message}`);
                continue;
            }
            if (!fetched.text || fetched.text.trim().length < 50) {
                console.log(`⚠️ Skipping ${fetched.title || item.ref} (no usable text)`);
                continue;
            }

            const schema = SCHEMAS[entityType] || SCHEMAS.characters;
            const data = await extractEntityJSON(
                fetched.title, fetched.text, displayName, schema,
                { provider: source.llm || null }
            );
            if (!data || !data.name) continue;

            // Post-extraction dedupe (covers adapters where titles resolve late).
            const update = { ...data, fandom: sourceKey, last_updated: Date.now() };
            if (fetched.imageUrl) update.image_url = fetched.imageUrl;

            await TargetModel.findOneAndUpdate(
                { fandom: sourceKey, name: data.name },
                update,
                { upsert: true, returnDocument: 'after' }
            );
            console.log(`✅ Synced ${data.name}${fetched.imageUrl ? ' (image)' : ''}`);
        }
    }
}

// CLI entrypoint
const [sourceKey, onlyEntityType] = process.argv.slice(2);
if (sourceKey) {
    runIngest(sourceKey, { onlyEntityType: onlyEntityType || null })
        .then(() => process.exit(0))
        .catch(e => { console.error('Ingest failed:', e.message); process.exit(1); });
}
