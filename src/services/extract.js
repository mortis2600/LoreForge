// LLM provider layer. Providers are an ordered array in config/llm.json;
// the first enabled provider is the default, the rest are automatic
// failover. A source can pin a provider with "llm": "<name>" in
// config/sources.json.
//
// Supported provider types: "deepseek", "ollama".

import 'dotenv/config';
import fs from 'fs';

const LLM_CONFIG_PATH = './config/llm.json';

// Max characters of source text sent per extraction call.
export const MAX_TEXT_CHARS = Number(process.env.MAX_TEXT_CHARS || 12000);

export function capText(text) {
    if (!text) return '';
    if (text.length <= MAX_TEXT_CHARS) return text;
    return text.slice(0, MAX_TEXT_CHARS) +
        `\n\n[truncated: ${(text.length - MAX_TEXT_CHARS).toLocaleString()} characters omitted]`;
}

export function loadProviders() {
    try {
        const arr = JSON.parse(fs.readFileSync(LLM_CONFIG_PATH, 'utf8'));
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

export function saveProviders(providers) {
    fs.writeFileSync(LLM_CONFIG_PATH, JSON.stringify(providers, null, 2));
}

export function listProviderTypes() {
    return Object.keys(PROVIDER_CALLS);
}

async function deepseekCall(cfg, messages, { temperature }) {
    const key = process.env[cfg.api_key_env || 'DEEPSEEK_API_KEY'];
    if (!key) throw new Error(`env var ${cfg.api_key_env || 'DEEPSEEK_API_KEY'} is not set`);
    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
            model: cfg.model || 'deepseek-chat',
            messages,
            response_format: { type: 'json_object' },
            temperature
        })
    });
    if (!response.ok) {
        throw new Error(`DeepSeek API error: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
}

async function ollamaCall(cfg, messages, { temperature }) {
    const host = (cfg.host || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const response = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: cfg.model || 'llama3.2',
            messages,
            format: 'json',
            stream: false,
            options: { temperature }
        })
    });
    if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    const content = data.message?.content || '';
    if (!content.trim()) throw new Error('Ollama returned empty content');
    return JSON.parse(content);
}

const PROVIDER_CALLS = {
    deepseek: deepseekCall,
    ollama: ollamaCall
};

async function runProvider(cfg, messages, opts) {
    const fn = PROVIDER_CALLS[cfg.provider];
    if (!fn) throw new Error(`Unknown LLM provider type: "${cfg.provider}"`);
    return fn(cfg, messages, opts);
}

// JSON-mode LLM call with automatic failover across enabled providers.
// Pass { provider: "<name>" } to pin a specific provider first.
export async function llmJSON(messages, { temperature = 0.1, provider = null } = {}) {
    const all = loadProviders().filter(p => p.enabled !== false);
    if (!all.length) {
        throw new Error('No LLM providers configured (config/llm.json is missing or empty)');
    }
    let ordered = all;
    if (provider) {
        const pinned = all.find(p => p.name === provider);
        if (!pinned) throw new Error(`Unknown LLM provider: "${provider}"`);
        ordered = [pinned, ...all.filter(p => p !== pinned)];
    }
    let lastErr = null;
    for (const cfg of ordered) {
        try {
            return await runProvider(cfg, messages, { temperature });
        } catch (e) {
            lastErr = e;
            console.error(`LLM provider "${cfg.name}" failed: ${e.message}`);
        }
    }
    throw lastErr;
}

// Extract one entity's structured fields from raw site text.
// Returns the parsed object (with name forced to entityName) or null.
export async function extractEntityJSON(entityName, rawText, sourceName, jsonSchema, opts = {}) {
    const text = capText(rawText);
    const prompt =
        `Extract information for "${entityName}" from the following ${sourceName} text. ` +
        `Ignore markup and formatting.\n\nTEXT:\n${text}`;
    try {
        const parsed = await llmJSON([
            { role: 'system', content: `Extract unstructured text into JSON matching this schema: ${JSON.stringify(jsonSchema)}` },
            { role: 'user', content: prompt }
        ], { temperature: 0.1, ...opts });
        return { ...parsed, name: entityName };
    } catch (err) {
        console.error(`LLM extraction failed for ${entityName}: ${err.message}`);
        return null;
    }
}
