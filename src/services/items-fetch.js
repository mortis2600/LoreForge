import axios from 'axios';
import 'dotenv/config';
import { capText, llmJSON } from './extract.js';
import connectDB from '../db.js';
import Item from '../models/Item.js';

const WIKI_API = process.env.WIKI_API_URL || 'https://dungeon-crawler-carl.fandom.com/api.php';

const JSON_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    type: { type: "string", description: "Weapon, Armor, Consumable, or Material" },
    tier: { type: "string", description: "Common, Rare, Epic, Legendary, Celestial, God" },
    owner: { type: "string", description: "Who primarily uses it" },
    ai_flavor_text: { type: "string", description: "CRITICAL: The exact snarky text the AI provided for the item." },
    mechanic_summary: { type: "string", description: "What the item actually does mechanically." },
    stats: { type: "string", description: "Any explicit stats (+5 Str) or 'None'" }
  },
  required: ["name", "ai_flavor_text", "mechanic_summary"]
};

async function extractItemJSON(itemName, rawWikiText) {
  const prompt = `Extract item information for "${itemName}" from the following Dungeon Crawler Carl wiki text. 
  CRITICAL INSTRUCTION: You MUST extract the verbatim, snarky flavor text provided by the Dungeon AI in the "ai_flavor_text" field. 
  Put what the item actually does in the "mechanic_summary" field.

  WIKI TEXT:
  ${rawWikiText}`;

  try {
    const extractedData = await llmJSON([
      { role: 'system', content: `You extract unstructured text into strictly typed JSON matching this schema: ${JSON.stringify(JSON_SCHEMA)}` },
      { role: 'user', content: prompt }
    ], { temperature: 0.1 });
    return { ...extractedData, name: itemName };
  } catch (error) {
    console.error(`LLM Extraction failed for ${itemName}:`, error.message);
    return null;
  }
}

async function runPipeline() {
  await connectDB();
  console.log('Fetching item list from DCC Wiki...');
  
  try {
    const listResponse = await axios.get(WIKI_API, {
      params: { action: 'query', list: 'categorymembers', cmtitle: 'Category:Items', cmlimit: 500, cmtype: 'page', format: 'json' }
    });

    const pages = listResponse.data.query.categorymembers;

    for (const page of pages) {
      console.log(`Processing: ${page.title}`);
      
      const pageResponse = await axios.get(WIKI_API, {
        params: { action: 'query', prop: 'revisions', titles: page.title, rvprop: 'content', rvslots: 'main', format: 'json' }
      });

      const pageId = Object.keys(pageResponse.data.query.pages)[0];
      const rawText = pageResponse.data.query.pages[pageId].revisions[0].slots.main['*'];
      
      const structuredData = await extractItemJSON(page.title, capText(rawText));
      
      if (structuredData) {
        await Item.findOneAndUpdate(
          { name: structuredData.name },
          { ...structuredData, last_updated: Date.now() },
          { upsert: true, returnDocument: 'after' }
        );
        console.log(`Saved ${structuredData.name} to MongoDB.`);
      }
    }
  } catch (error) {
    console.error('Pipeline error:', error.message);
  } finally {
    process.exit(0);
  }
}
runPipeline();
