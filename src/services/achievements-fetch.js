import axios from 'axios';
import 'dotenv/config';
import { capText, llmJSON, loadProviders } from './extract.js';
import connectDB from '../db.js';
import Achievement from '../models/Achievement.js';

const WIKI_API = process.env.WIKI_API_URL || 'https://dungeon-crawler-carl.fandom.com/api.php';

// Updated Schema: Added `ai_flavor_text` and `mechanic_summary` to separate the joke from the trigger
const JSON_SCHEMA = {
  type: "object",
  properties: {
    achievements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          ai_flavor_text: { 
            type: "string", 
            description: "CRITICAL: Extract the EXACT quote or snarky description provided by the Dungeon AI. Do not summarize it. If it says 'We don't reward weird behavior', capture exactly that." 
          },
          mechanic_summary: { 
            type: "string", 
            description: "A brief summary of what the crawler actually did to trigger the achievement (e.g., 'killing two mobs using only their bodies')." 
          },
          recipient: { type: "string", description: "The character who received it (e.g., Carl, Donut, Prepotente)." },
          floor: { type: "integer", description: "The floor number. Use 0 if unknown." },
          reward: { type: "string", description: "Specific boxes or items awarded. (e.g., 'Gold Brawler Box')." },
          category: { type: "string", description: "The tier (Bronze, Silver, Gold, Celestial, Legendary)." }
        },
        required: ["title", "ai_flavor_text", "mechanic_summary", "recipient"]
      }
    }
  },
  required: ["achievements"]
};

async function extractAchievementsJSON(pageTitle, rawWikiText) {
  const prompt = `You are a data extraction assistant. The following wiki text from "${pageTitle}" contains MULTIPLE achievements. 
  Extract EVERY achievement listed into an array of objects. 
  
  CRITICAL INSTRUCTION: You MUST extract the verbatim, snarky flavor text provided by the Dungeon AI in the "ai_flavor_text" field. DO NOT summarize the AI's jokes. 
  Put the mechanical reason they got the achievement in the "mechanic_summary" field.

  WIKI TEXT:
  ${rawWikiText}`;

  try {
    const parsed = await llmJSON([
      { role: 'system', content: `You extract unstructured text into strictly typed JSON matching this schema: ${JSON.stringify(JSON_SCHEMA)}` },
      { role: 'user', content: prompt }
    ], { temperature: 0.1 });

    return parsed.achievements;
  } catch (error) {
    console.error(`LLM Extraction failed for ${pageTitle}:`, error.message);
    return null;
  }
}

async function runPipeline() {
  if (!loadProviders().length) {
    console.error('FATAL: no LLM providers configured in config/llm.json');
    process.exit(1);
  }

  await connectDB();
  console.log('1. Fetching achievement lists from DCC Wiki...');
  
  try {
    const listResponse = await axios.get(WIKI_API, {
      params: { action: 'query', list: 'categorymembers', cmtitle: 'Category:Achievements', cmlimit: 50000, cmtype: 'page', format: 'json' }
    });

    const pages = listResponse.data.query.categorymembers;

    for (const page of pages) {
      if (page.title === 'Achievement') continue;

      console.log(`\nProcessing: ${page.title}`);
      
      const pageResponse = await axios.get(WIKI_API, {
        params: { action: 'query', prop: 'revisions', titles: page.title, rvprop: 'content', rvslots: 'main', format: 'json' }
      });

      const pageId = Object.keys(pageResponse.data.query.pages)[0];
      const rawText = pageResponse.data.query.pages[pageId].revisions[0].slots.main['*'];
      
      const structuredAchievements = await extractAchievementsJSON(page.title, capText(rawText));
      
      if (structuredAchievements && structuredAchievements.length > 0) {
        console.log(`Extracted ${structuredAchievements.length} achievements from ${page.title}. Saving...`);
        for (const achievement of structuredAchievements) {
          // Flatten the description for the current schema, or you can update the schema to split them.
          // For now, we will merge the snarky AI text and the mechanic summary so the API returns both cleanly.
          const combinedDescription = `${achievement.ai_flavor_text} | Trigger: ${achievement.mechanic_summary}`;
          
          await Achievement.findOneAndUpdate(
            { title: achievement.title },
            { 
              ...achievement, 
              description: combinedDescription,
              last_updated: Date.now() 
            },
            { upsert: true, returnDocument: 'after' }
          );
        }
        console.log(`Saved ${structuredAchievements.length} achievements to MongoDB.`);
      } else {
        console.log(`No achievements extracted from ${page.title}.`);
      }
    }
  } catch (error) {
    console.error('Pipeline error:', error.message);
  } finally {
    process.exit(0);
  }
}

runPipeline();
