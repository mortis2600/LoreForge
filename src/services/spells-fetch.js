import axios from 'axios';
import 'dotenv/config';
import { capText } from './extract.js';
import connectDB from '../db.js';
import Spell from '../models/Spell.js';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const WIKI_API = process.env.WIKI_API_URL || 'https://dungeon-crawler-carl.fandom.com/api.php';

const JSON_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    school: { type: "string", description: "e.g., Evocation, Necromancy, Illusion, etc." },
    level: { type: "integer", description: "Spell level. Use 0 if unknown." },
    caster: { type: "string", description: "The character who uses it most prominently (e.g., Donut, Prepotente, Mordecai)" },
    description: { type: "string", description: "What the spell does mechanically." },
    ai_flavor_text: { type: "string", description: "The exact snarky text or lore provided by the AI for this spell." }
  },
  required: ["name", "description"]
};

async function extractSpellJSON(spellName, rawWikiText) {
  const prompt = `Extract spell information for "${spellName}" from the following Dungeon Crawler Carl wiki text. 
  Capture what the spell does mechanically in the "description" field. If the Dungeon AI provides snarky flavor text for the spell, extract it verbatim into "ai_flavor_text".

  WIKI TEXT:
  ${rawWikiText}`;

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: `You extract unstructured text into strictly typed JSON matching this schema: ${JSON.stringify(JSON_SCHEMA)}` },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      })
    });

    if (!response.ok) throw new Error(`DeepSeek API Error: ${response.status}`);
    const data = await response.json();
    return { ...JSON.parse(data.choices[0].message.content), name: spellName };
  } catch (error) {
    console.error(`LLM Extraction failed for ${spellName}:`, error.message);
    return null;
  }
}

async function runPipeline() {
  await connectDB();
  console.log('Fetching spell list from DCC Wiki...');
  
  try {
    const listResponse = await axios.get(WIKI_API, {
      params: { action: 'query', list: 'categorymembers', cmtitle: 'Category:Spells', cmlimit: 500, cmtype: 'page', format: 'json' }
    });

    const pages = listResponse.data.query.categorymembers;

    for (const page of pages) {
      console.log(`Processing: ${page.title}`);
      
      const pageResponse = await axios.get(WIKI_API, {
        params: { action: 'query', prop: 'revisions', titles: page.title, rvprop: 'content', rvslots: 'main', format: 'json' }
      });

      const pageId = Object.keys(pageResponse.data.query.pages)[0];
      const rawText = pageResponse.data.query.pages[pageId].revisions[0].slots.main['*'];
      
      const structuredData = await extractSpellJSON(page.title, capText(rawText));
      
      if (structuredData) {
        await Spell.findOneAndUpdate(
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
