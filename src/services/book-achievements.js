// Book achievement extractor. Reads chapters from an epub source (see
// adapters/epub.js), finds Dungeon AI achievement announcements with a
// regex pre-filter, and structures each one with the LLM. Only candidate
// passages go to the LLM, so a whole book costs a handful of calls.
//
// Usage:
//   node src/services/book-achievements.js <sourceKey>
//
// Source config (config/sources.json):
//   "dcc-book-1": { "adapter": "epub",
//                   "epub_path": "/home/dev/books/dcc-book-1.epub",
//                   "book": 1, "floor": 1,
//                   "display_name": "Dungeon Crawler Carl, Book 1" }
//
// Book-sourced records win over wiki-sourced ones on title match; the
// wiki record's missing fields are merged in rather than dropped.

import 'dotenv/config';
import { getAdapter } from '../adapters/index.js';
import { llmJSON } from './extract.js';
import connectDB from '../db.js';
import Achievement from '../models/Achievement.js';
import { loadSources } from './ingest.js';

const ANNOUNCE_RE = /new achievement!/gi;
const CTX_BEFORE = 300;   // chars before the announcement (recipient context)
const CTX_AFTER = 1200;    // chars after (flavor text + reward)

function findCandidates(text) {
    const out = [];
    let m;
    while ((m = ANNOUNCE_RE.exec(text)) !== null) {
        const start = Math.max(0, m.index - CTX_BEFORE);
        const end = Math.min(text.length, m.index + m[0].length + CTX_AFTER);
        out.push({ at: m.index, block: text.slice(start, end) });
    }
    return out;
}

function normTitle(t) {
    return (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Robust dedupe: normalize titles on both sides (strips apostrophes,
// punctuation, spacing differences like "aren't" vs "aren t").
// Returns ALL matching docs so the caller can prefer book-sourced ones.
async function findAllMatching(title) {
    const firstWord = (title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')[0];
    let cands;
    if (!firstWord || firstWord.length < 3) {
        cands = await Achievement.find({}).select('title source');
    } else {
        cands = await Achievement.find({
            title: new RegExp('^' + escapeRegExp(firstWord), 'i')
        });
    }
    const want = normTitle(title);
    return cands.filter(d => normTitle(d.title) === want);
}

async function structureBlock(block, { book, floor, chapterTitle, displayName }) {
    const prompt = `You are a data extraction assistant. The passage below is from "${displayName}", chapter "${chapterTitle}". It contains Dungeon AI achievement announcements.

Extract EVERY achievement announced in the passage into an array of objects.

CRITICAL: the "ai_flavor_text" field must be the AI's snarky announcement description, captured as written. Do NOT summarize the jokes. Put what the crawler actually did to trigger it in "mechanic_summary", in your own words.

- title: the achievement name (e.g. "Bitchmeat!")
- recipient: who received it (Carl, Donut, etc.). Infer from surrounding text; use "Unknown" if truly unclear.
- floor: the dungeon floor. This book covers floor ${floor} unless the passage says otherwise; use 0 if unknown.
- reward: specific boxes or items awarded (e.g. "Gold Brawler Box"), or null if none is stated.
- category: tier if stated (Bronze, Silver, Gold, Celestial, Legendary), else null.

Return ONLY a JSON object: { "achievements": [ ... ] }

PASSAGE:
${block}`;

    try {
        const parsed = await llmJSON([{ role: 'user', content: prompt }], { temperature: 0.2 });
        return parsed.achievements || [];
    } catch (e) {
        console.error(`   LLM structuring failed: ${e.message}`);
        return [];
    }
}

export async function runBookAchievements(sourceKey) {
    const sources = loadSources();
    const source = sources[sourceKey];
    if (!source) throw new Error(`Unknown source: ${sourceKey}`);
    if (source.adapter !== 'epub') throw new Error(`Source ${sourceKey} is not an epub source`);

    const adapter = getAdapter('epub');
    const { book, floor, display_name } = source;

    await connectDB();

    const { items } = await adapter.listItems(source);
    console.log(`📖 ${display_name}: ${items.length} chapters`);

    let candidates = 0, extracted = 0, created = 0, upgraded = 0, skipped = 0;

    for (const item of items) {
        let fetched;
        try {
            fetched = await adapter.fetchItem(source, item);
        } catch (e) {
            console.error(`⚠️ Fetch failed for ${item.title}: ${e.message}`);
            continue;
        }
        if (!fetched.text || fetched.text.length < 100) continue;

        const blocks = findCandidates(fetched.text);
        if (blocks.length === 0) continue;
        candidates += blocks.length;
        console.log(`\n📄 ${item.title}: ${blocks.length} announcement(s)`);

        for (const { block } of blocks) {
            const list = await structureBlock(block, {
                book, floor, chapterTitle: item.title, displayName: display_name
            });
            for (const a of list) {
                if (!a.title) continue;
                extracted += 1;
                const doc = {
                    title: a.title.trim(),
                    description: a.mechanic_summary || a.ai_flavor_text || a.title,
                    ai_flavor_text: a.ai_flavor_text || null,
                    mechanic_summary: a.mechanic_summary || null,
                    recipient: a.recipient || 'Unknown',
                    floor: Number.isInteger(a.floor) ? a.floor : (floor ?? 0),
                    reward: a.reward || null,
                    category: a.category || null,
                    source: 'book',
                    book,
                    chapter: item.title,
                    last_updated: Date.now()
                };
                const matches = await findAllMatching(doc.title);
                const bookDoc = matches.find(d => d.source === 'book');
                if (bookDoc) {
                    skipped += 1;
                    continue;
                }
                const wikiDoc = matches.find(d => d.source !== 'book');
                if (!wikiDoc) {
                    await Achievement.create(doc);
                    created += 1;
                    console.log(`   ✅ NEW: ${doc.title}`);
                } else {
                    // Book wins: overwrite with book data, keep any wiki-only fields we lack.
                    // Never touch title/_id (renaming a wiki doc onto the book title
                    // would collide with the book doc itself).
                    for (const [k, v] of Object.entries(doc)) {
                        if (k === 'title' || k === '_id') continue;
                        if (v !== null && v !== undefined && v !== 'Unknown' && v !== 0) wikiDoc[k] = v;
                        else if (!wikiDoc[k]) wikiDoc[k] = v;
                    }
                    wikiDoc.source = 'book';
                    await wikiDoc.save();
                    upgraded += 1;
                    console.log(`   ⬆️ UPGRADED (was wiki): ${wikiDoc.title}`);
                }
            }
        }
    }

    console.log(`\nDone. Chapters: ${items.length}, announcements: ${candidates}, extracted: ${extracted}, new: ${created}, upgraded from wiki: ${upgraded}, already had: ${skipped}`);
    return { chapters: items.length, candidates, extracted, created, upgraded, skipped };
}

const [sourceKey] = process.argv.slice(2);
const isMain = (process.argv[1] || '').endsWith('services/book-achievements.js');
if (isMain && sourceKey) {
    runBookAchievements(sourceKey)
        .then(() => process.exit(0))
        .catch(e => { console.error('Book extraction failed:', e.message); process.exit(1); });
}
