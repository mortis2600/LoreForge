// Shared LLM extraction layer. Every adapter funnels raw site content through
// here to get structured JSON. Text is capped before it ever reaches the API
// so one giant page can't blow the context window or the budget.

import 'dotenv/config';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

// Max characters of source text sent per extraction call.
export const MAX_TEXT_CHARS = Number(process.env.MAX_TEXT_CHARS || 12000);

export function capText(text) {
    if (!text) return '';
    if (text.length <= MAX_TEXT_CHARS) return text;
    return text.slice(0, MAX_TEXT_CHARS) +
        `\n\n[truncated: ${(text.length - MAX_TEXT_CHARS).toLocaleString()} characters omitted]`;
}

// Raw JSON-mode call. Throws on HTTP or parse errors; callers decide retries.
export async function deepseekJSON(messages, { temperature = 0.1 } = {}) {
    if (!DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY is not set. Ingestion requires it.');
    }
    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: MODEL,
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

// Extract one entity's structured fields from raw site text.
// Returns the parsed object (with name forced to entityName) or null.
export async function extractEntityJSON(entityName, rawText, sourceName, jsonSchema) {
    const text = capText(rawText);
    const prompt =
        `Extract information for "${entityName}" from the following ${sourceName} text. ` +
        `Ignore markup and formatting.\n\nTEXT:\n${text}`;
    try {
        const parsed = await deepseekJSON([
            { role: 'system', content: `Extract unstructured text into JSON matching this schema: ${JSON.stringify(jsonSchema)}` },
            { role: 'user', content: prompt }
        ]);
        return { ...parsed, name: entityName };
    } catch (err) {
        console.error(`LLM extraction failed for ${entityName}: ${err.message}`);
        return null;
    }
}
