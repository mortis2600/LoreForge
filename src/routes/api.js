// Public API routes, mounted at /api/v1 (behind requireApiKey).
// All user-supplied name/query input is regex-escaped before hitting Mongo.

import express from 'express';
import { escapeRegExp } from '../util.js';
import Character from '../models/Character.js';
import Item from '../models/Item.js';
import Spell from '../models/Spell.js';
import Location from '../models/Location.js';
import Trivia from '../models/Trivia.js';
import Achievement from '../models/Achievement.js';

const router = express.Router();

const MODELS = {
    characters: Character,
    items: Item,
    spells: Spell,
    locations: Location
};

// Metadata: every source key currently in the DB
router.get('/meta/sources', async (req, res) => {
    try {
        const fandoms = new Set();
        for (const Model of Object.values(MODELS)) {
            const list = await Model.distinct('fandom');
            list.forEach(f => fandoms.add(f));
        }
        res.json({ sources: Array.from(fandoms).sort() });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch source metadata.' });
    }
});

// Alias for the old route name
router.get('/meta/fandoms', (req, res) => {
    res.redirect(307, '/api/v1/meta/sources');
});

// Global search across all entity types
router.get('/search', async (req, res) => {
    // Coerce: with the 'simple' query parser these are always strings, but
    // belt-and-braces in case the parser setting ever changes (qs nesting
    // would otherwise allow Mongo operator injection via ?fandom[$ne]=x).
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const fandom = typeof req.query.fandom === 'string' ? req.query.fandom : undefined;
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
    const limit = req.query.limit;

    if (!q || q.trim() === '') {
        return res.status(400).json({ error: 'Search query parameter "q" is required.' });
    }

    const searchQuery = q.trim();
    const safePattern = escapeRegExp(searchQuery);
    const queryFilter = { name: { $regex: safePattern, $options: 'i' } };
    if (fandom) queryFilter.fandom = fandom;

    try {
        // Demo instances cap page sizes so the public demo can't stand in
        // for a real install. req.demo is only set for loopback (funnel)
        // traffic when DEMO_MODE is on; DEMO_MODE=false removes all caps.
        const maxLimit = Math.min(Number(limit) || 20, req.demo ? 20 : 100);
        let results = [];

        if (entityType && MODELS[entityType.toLowerCase()]) {
            const TargetModel = MODELS[entityType.toLowerCase()];
            const data = await TargetModel.find(queryFilter).limit(maxLimit).select('-__v');
            results = data.map(item => ({ type: entityType.toLowerCase(), ...item.toObject() }));
        } else {
            const settled = await Promise.all(
                Object.entries(MODELS).map(async ([type, Model]) => {
                    const data = await Model.find(queryFilter).limit(maxLimit).select('-__v');
                    return data.map(item => ({ type, ...item.toObject() }));
                })
            );
            results = settled.flat();
        }

        res.json({
            query: searchQuery,
            fandom_filter: fandom || 'all',
            total_results: results.length,
            results
        });
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Search execution failed.' });
    }
});

// Random trivia question for a source
router.get('/:fandom/trivia/random', async (req, res) => {
    try {
        const [question] = await Trivia.aggregate([
            { $match: { fandom: req.params.fandom } },
            { $sample: { size: 1 } }
        ]);
        if (!question) return res.status(404).json({ error: 'No trivia found for this source.' });

        // Shuffle options so the answer isn't always first
        const options = [...(question.options || [])];
        for (let i = options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [options[i], options[j]] = [options[j], options[i]];
        }
        res.json({ ...question, options });
    } catch (err) {
        console.error('Trivia error:', err);
        res.status(500).json({ error: 'Failed to fetch trivia.' });
    }
});

// Achievements (book- and wiki-sourced). Defined before the generic
// /:fandom/:entityType routes so they aren't swallowed by them.
router.get('/achievements', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, req.demo ? 50 : 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const filter = {};
    if (req.query.source) filter.source = req.query.source;
    if (req.query.book) filter.book = Number(req.query.book);
    try {
        const [data, total] = await Promise.all([
            Achievement.find(filter).limit(limit).skip((page - 1) * limit)
                .select('-__v').sort({ book: 1, title: 1 }),
            Achievement.countDocuments(filter)
        ]);
        res.json({ entity_type: 'achievements', total, total_returned: data.length, page, data });
    } catch (err) {
        res.status(500).json({ error: 'Database query failed.' });
    }
});

router.get('/achievements/:title', async (req, res) => {
    try {
        const doc = await Achievement.findOne({
            title: new RegExp('^' + escapeRegExp(req.params.title) + '$', 'i')
        }).select('-__v');
        if (!doc) return res.status(404).json({ error: 'Achievement not found' });
        res.json(doc);
    } catch (err) {
        res.status(500).json({ error: 'Database query failed.' });
    }
});

// Paginated entity listing
router.get('/:fandom/:entityType', async (req, res) => {
    const { fandom, entityType } = req.params;
    const limit = Math.min(Number(req.query.limit) || 50, req.demo ? 50 : 200);
    const page = Math.max(Number(req.query.page) || 1, 1);

    const TargetModel = MODELS[entityType.toLowerCase()];
    if (!TargetModel) return res.status(400).json({ error: `Invalid entity type: ${entityType}` });

    try {
        const data = await TargetModel.find({ fandom })
            .limit(limit)
            .skip((page - 1) * limit)
            .select('-__v');

        res.json({ fandom, entity_type: entityType, total_returned: data.length, page, data });
    } catch (err) {
        res.status(500).json({ error: 'Database query failed.' });
    }
});

// Single entity by exact name (case-insensitive). Input is regex-escaped.
router.get('/:fandom/:entityType/:name', async (req, res) => {
    const { fandom, entityType, name } = req.params;

    const TargetModel = MODELS[entityType.toLowerCase()];
    if (!TargetModel) return res.status(400).json({ error: `Invalid entity type: ${entityType}` });

    try {
        const entity = await TargetModel.findOne({
            fandom,
            name: { $regex: `^${escapeRegExp(name)}$`, $options: 'i' }
        }).select('-__v');

        if (!entity) return res.status(404).json({ error: `${entityType} not found.` });
        res.json(entity);
    } catch (err) {
        res.status(500).json({ error: 'Database query failed.' });
    }
});

export default router;
