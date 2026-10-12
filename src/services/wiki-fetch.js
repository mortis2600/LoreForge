import axios from 'axios';
import 'dotenv/config';
import { capText, llmJSON, loadProviders } from './extract.js';
import connectDB from '../db.js';
import Character from '../models/Character.js';

const WIKI_API = process.env.WIKI_API_URL || 'https://dungeon-crawler-carl.fandom.com/api.php';

const JSON_SCHEMA = {
    type: "object",
    properties: {
        name: { type: "string" },
        aliases: { type: "array", items: { type: "string" } },
        species: { type: "string" },
        class: { type: "string", description: "LitRPG class, if any" },
        level: { type: "integer" },
        origin: { type: "string" },
        is_crawler: { type: "boolean" },
        crawler_number: { type: "string", description: "Crawler ID number if applicable" },
        affiliations: { type: "array", items: { type: "string" }, description: "Groups, syndicates, factions, or deities" },
        status: { type: "string", description: "Alive, Dead, or Unknown" },
        description: { type: "string", description: "A concise 1-2 sentence summary of the character based on the text" }
    },
    required: ["name", "species", "is_crawler", "description"]
};

async function extractCharacterJSON(characterName, rawWikiText) {
    const prompt = `You are a data extraction assistant. Extract character information for "${characterName}" from the following Dungeon Crawler Carl wiki text.
    Ignore wiki formatting. Infer "is_crawler" to true if they are from Earth or have a crawler number.
    Analyze the text carefully to provide an accurate 1-2 sentence description and determine their current status (Alive/Dead) if mentioned.

    WIKI TEXT:
    ${rawWikiText}`;

    try {
        const extractedData = await llmJSON([
            { role: 'system', content: `You are an API that extracts unstructured text into strictly typed JSON matching this schema: ${JSON.stringify(JSON_SCHEMA)}` },
            { role: 'user', content: prompt }
        ], { temperature: 0.1 });

        return {
            ...extractedData,
            name: characterName
        };
    } catch (error) {
        console.error(`LLM Extraction failed for ${characterName}:`, error.message);
        return null;
    }
}

async function runPipeline() {
    if (!loadProviders().length) {
        console.error('FATAL: no LLM providers configured in config/llm.json');
        process.exit(1);
    }

    await connectDB();
    console.log('1. Fetching character list from DCC Wiki...');
    
    try {
        const listResponse = await axios.get(WIKI_API, {
            params: { action: 'query', list: 'categorymembers', cmtitle: 'Category:Characters', cmlimit: 500, cmtype: 'page', format: 'json' }
        });

        const pages = listResponse.data.query.categorymembers;

        for (const page of pages) {
            console.log(`\nProcessing: ${page.title}`);
            
            const pageResponse = await axios.get(WIKI_API, {
                params: { 
                    action: 'query', 
                    prop: 'revisions|pageimages', 
                    titles: page.title, 
                    rvprop: 'content', 
                    rvslots: 'main', 
                    piprop: 'original',
                    format: 'json' 
                }
            });

            const pageId = Object.keys(pageResponse.data.query.pages)[0];
            const pageData = pageResponse.data.query.pages[pageId];
            
            const rawText = pageData.revisions?.[0]?.slots?.main['*'] || '';
            const imageUrl = pageData.original?.source || null;
            
            const structuredData = await extractCharacterJSON(page.title, capText(rawText));
            
            if (structuredData) {
                await Character.findOneAndUpdate(
                    { name: structuredData.name },
                    { ...structuredData, image_url: imageUrl, last_updated: Date.now() },
                    { upsert: true, returnDocument: 'after' }
                );
                console.log(`Saved ${structuredData.name} to MongoDB (Image: ${imageUrl ? 'Yes' : 'None'}).`);
            }
        }
    } catch (error) {
        console.error('Pipeline error:', error.message);
    } finally {
        process.exit(0);
    }
}

runPipeline();
