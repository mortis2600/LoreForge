// MediaWiki adapter: ingests any MediaWiki site (Fandom wikis, independent
// wikis like bg3.wiki, Wikipedia) via the API. No HTML scraping.
//
// listItems() scans categories with folder-diving (dives into subcategories)
// and pagination. If a category comes back empty, it asks the LLM for
// alternative category names and auto-patches the source config.
// fetchItem() returns raw wikitext plus the page's main image.

import axios from 'axios';
import { llmJSON } from '../services/extract.js';

export const name = 'mediawiki';

async function getCategoryPages(wikiApiUrl, categoryTitle) {
    let pages = [];
    let subcats = [];
    let cmcontinue = null;

    console.log(`\n📂 Scanning primary category: ${categoryTitle}`);

    // Level 1: root pages + sub-folders
    do {
        const res = await axios.get(wikiApiUrl, {
            params: {
                action: 'query', list: 'categorymembers', cmtitle: categoryTitle,
                cmlimit: 500, cmtype: 'page|subcat', cmcontinue, format: 'json'
            }
        });
        const members = res.data.query?.categorymembers || [];
        pages.push(...members.filter(m => m.ns === 0));
        subcats.push(...members.filter(m => m.ns === 14));
        cmcontinue = res.data.continue?.cmcontinue;
    } while (cmcontinue);

    // Level 2: dive into every sub-folder
    for (const subcat of subcats) {
        console.log(`   ↳ Opening sub-folder: ${subcat.title}`);
        cmcontinue = null;
        do {
            const res = await axios.get(wikiApiUrl, {
                params: {
                    action: 'query', list: 'categorymembers', cmtitle: subcat.title,
                    cmlimit: 500, cmtype: 'page', cmnamespace: 0, cmcontinue, format: 'json'
                }
            });
            pages.push(...(res.data.query?.categorymembers || []));
            cmcontinue = res.data.continue?.cmcontinue;
        } while (cmcontinue);
    }

    // Dedupe by pageid (a page can live in several sub-folders)
    return Array.from(new Map(pages.map(p => [p.pageid, p])).values());
}

async function aiHealCategory(wikiApiUrl, entityType, originalCategory) {
    console.log(`\n🤖 AI attempting to self-heal missing category: ${originalCategory}...`);
    try {
        const parsed = await llmJSON([
            { role: 'user', content: `A MediaWiki site returned 0 results for "${originalCategory}". Provide exactly 5 alternative category names (starting with 'Category:') that a fan wiki might use for "${entityType}". Return ONLY a JSON object with an array of strings under the key "alternatives".` }
        ], { temperature: 0.3 });
        const alternatives = parsed.alternatives || [];
        console.log(`🧠 AI suggested alternatives: ${alternatives.join(', ')}`);

        for (const alt of alternatives) {
            const testPages = await getCategoryPages(wikiApiUrl, alt);
            if (testPages.length > 0) {
                console.log(`✅ AI found data under: ${alt}`);
                return alt;
            }
        }
    } catch (e) {
        console.error('AI healing failed:', e.message);
    }
    return null;
}

export async function listItems(source, entityType) {
    let categoryTitle = source.categories?.[entityType];
    if (!categoryTitle) {
        console.log(`⚠️ No category configured for ${entityType}, skipping.`);
        return { items: [] };
    }

    let pages = await getCategoryPages(source.wiki_api_url, categoryTitle);

    if (pages.length === 0) {
        const healed = await aiHealCategory(source.wiki_api_url, entityType, categoryTitle);
        if (healed) {
            pages = await getCategoryPages(source.wiki_api_url, healed);
            return { items: pages.map(p => ({ ref: p.pageid, title: p.title })), patchedCategory: healed };
        }
        console.log(`❌ AI could not find a replacement for ${categoryTitle}. Skipping.`);
    }

    return { items: pages.map(p => ({ ref: p.pageid, title: p.title })) };
}

export async function fetchItem(source, item) {
    const res = await axios.get(source.wiki_api_url, {
        params: {
            action: 'query', prop: 'revisions|pageimages', titles: item.title,
            rvprop: 'content', rvslots: 'main', piprop: 'original', format: 'json'
        }
    });
    const pageId = Object.keys(res.data.query.pages)[0];
    const page = res.data.query.pages[pageId];
    const text = page.revisions?.[0]?.slots?.main?.['*'] || '';
    const imageUrl = page.original?.source || null;
    return { title: item.title, text, imageUrl };
}
