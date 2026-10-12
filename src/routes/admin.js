// Admin API: manage LLM providers, site sources, ingest jobs, and stats.
// Mounted at /api/v1/admin (behind the standard API auth).
//
// Secrets are never exposed: provider entries report which env var holds the
// key and whether it's set, never the value.

import express from 'express';
import {
    loadProviders, saveProviders, listProviderTypes, llmJSON
} from '../services/extract.js';
import { loadSources, saveSources } from '../services/ingest.js';
import { listAdapters } from '../adapters/index.js';
import { startIngestJob, startTriviaJob, listJobs, getJob } from '../services/jobs.js';
import Character from '../models/Character.js';
import Item from '../models/Item.js';
import Spell from '../models/Spell.js';
import Location from '../models/Location.js';
import Trivia from '../models/Trivia.js';

const router = express.Router();
const MODELS = { characters: Character, items: Item, spells: Spell, locations: Location };

function redactProviders() {
    return loadProviders().map(p => ({
        ...p,
        api_key_set: p.api_key_env ? Boolean(process.env[p.api_key_env]) : null
    }));
}

function validateProvider(p) {
    if (!p || typeof p !== 'object') return 'each provider must be an object';
    if (!p.name || typeof p.name !== 'string') return 'provider.name is required';
    if (!listProviderTypes().includes(p.provider)) {
        return `provider.provider must be one of: ${listProviderTypes().join(', ')}`;
    }
    return null;
}

// ---- LLM providers ----

router.get('/llm', (req, res) => {
    res.json({ providers: redactProviders(), types: listProviderTypes() });
});

router.put('/llm', (req, res) => {
    const providers = req.body?.providers;
    if (!Array.isArray(providers) || providers.length === 0) {
        return res.status(400).json({ error: 'body.providers must be a non-empty array' });
    }
    for (const p of providers) {
        const err = validateProvider(p);
        if (err) return res.status(400).json({ error: err });
    }
    const names = providers.map(p => p.name);
    if (new Set(names).size !== names.length) {
        return res.status(400).json({ error: 'provider names must be unique' });
    }
    saveProviders(providers);
    res.json({ ok: true, providers: redactProviders() });
});

// Live-test one provider with a tiny extraction prompt
router.post('/llm/:name/test', async (req, res) => {
    const { name } = req.params;
    try {
        const result = await llmJSON([
            { role: 'system', content: 'Return ONLY a JSON object with exactly these keys: {"ping": "pong", "model": "<your model name>"}' },
            { role: 'user', content: 'ping' }
        ], { temperature: 0, provider: name });
        res.json({ ok: true, provider: name, result });
    } catch (e) {
        res.status(502).json({ ok: false, provider: name, error: e.message });
    }
});

// ---- Sources ----

router.get('/sources', (req, res) => {
    res.json({ sources: loadSources(), adapters: listAdapters() });
});

router.put('/sources', (req, res) => {
    const sources = req.body?.sources;
    if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
        return res.status(400).json({ error: 'body.sources must be an object keyed by source name' });
    }
    for (const [key, s] of Object.entries(sources)) {
        if (!s || typeof s !== 'object') return res.status(400).json({ error: `source "${key}" must be an object` });
        if (!listAdapters().includes(s.adapter || 'mediawiki')) {
            return res.status(400).json({ error: `source "${key}": unknown adapter "${s.adapter}"` });
        }
    }
    saveSources(sources);
    res.json({ ok: true, sources: loadSources() });
});

// ---- Jobs ----

router.post('/ingest/:source', (req, res) => {
    const { source } = req.params;
    const { entityType } = req.body || {};
    if (!loadSources()[source]) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
    }
    const job = startIngestJob(source, entityType || null);
    res.status(202).json({ ok: true, job });
});

router.post('/trivia/:source', (req, res) => {
    const { source } = req.params;
    const count = Math.min(Number(req.body?.count) || 100, 1000);
    if (!loadSources()[source]) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
    }
    const job = startTriviaJob(source, count);
    res.status(202).json({ ok: true, job });
});

router.get('/jobs', (req, res) => {
    res.json({ jobs: listJobs() });
});

router.get('/jobs/:id', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Unknown job' });
    res.json({ job });
});

// ---- Stats ----

router.get('/stats', async (req, res) => {
    try {
        const perModel = {};
        for (const [type, Model] of Object.entries(MODELS)) {
            perModel[type] = await Model.countDocuments();
        }
        perModel.trivia = await Trivia.countDocuments();

        const perSource = {};
        for (const [type, Model] of [...Object.entries(MODELS), ['trivia', Trivia]]) {
            const rows = await Model.aggregate([
                { $group: { _id: '$fandom', n: { $sum: 1 } } }
            ]);
            for (const r of rows) {
                const key = r._id || 'untagged';
                perSource[key] = perSource[key] || {};
                perSource[key][type] = r.n;
            }
        }
        res.json({ perModel, perSource });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
