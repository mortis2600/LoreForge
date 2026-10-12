// Generic HTML adapter: json-ifies ordinary websites. Give it a list of URLs
// or a sitemap.xml and it extracts each page's title, main text, and social
// image. Good for blogs, docs sites, news archives, or any wiki that has no
// API.
//
// Source config shape:
//   { "adapter": "html", "display_name": "My Blog",
//     "urls": ["https://example.com/post-1"],
//     "sitemap": "https://example.com/sitemap.xml" }
// Entity types are free-form; every URL is ingested under each configured
// entity type (or set "entity_types": { "characters": { "urls": [...] } }
// to scope URLs per type).

import axios from 'axios';
import * as cheerio from 'cheerio';

export const name = 'html';

const UA = 'LoreForge/1.0 (+https://github.com/)';

async function fetchSitemapUrls(sitemapUrl) {
    const res = await axios.get(sitemapUrl, { headers: { 'User-Agent': UA }, timeout: 15000 });
    const $ = cheerio.load(res.data, { xmlMode: true });
    const locs = $('loc').map((_, el) => $(el).text().trim()).get();
    // Sitemap indexes point at more sitemaps; plain sitemaps point at pages.
    const nested = [];
    for (const loc of locs) {
        if (/sitemap.*\.xml/i.test(loc)) {
            try {
                nested.push(...(await fetchSitemapUrls(loc)));
            } catch (e) {
                console.error(`  ⚠️ Could not read nested sitemap ${loc}: ${e.message}`);
            }
        }
    }
    const pages = locs.filter(l => !/sitemap.*\.xml/i.test(l));
    return [...pages, ...nested];
}

export async function listItems(source, entityType) {
    const scoped = source.entity_types?.[entityType];
    const cfg = scoped || source;

    let urls = [...(cfg.urls || [])];
    if (cfg.sitemap) {
        console.log(`\n🗺️ Reading sitemap: ${cfg.sitemap}`);
        try {
            urls.push(...(await fetchSitemapUrls(cfg.sitemap)));
        } catch (e) {
            console.error(`⚠️ Sitemap read failed: ${e.message}`);
        }
    }
    urls = [...new Set(urls)].filter(u => /^https?:\/\//.test(u));
    console.log(`📄 Found ${urls.length} URLs for ${entityType}`);
    // Titles are resolved at fetch time for HTML pages.
    return { items: urls.map(u => ({ ref: u, title: null })) };
}

export async function fetchItem(source, item) {
    const res = await axios.get(item.ref, {
        headers: { 'User-Agent': UA },
        timeout: 15000,
        maxContentLength: 5 * 1024 * 1024,
        responseType: 'text'
    });
    const $ = cheerio.load(res.data);

    $('script, style, nav, header, footer, aside, noscript, form, iframe').remove();

    const title =
        $('meta[property="og:title"]').attr('content') ||
        $('title').first().text().trim() ||
        item.ref;
    const imageUrl = $('meta[property="og:image"]').attr('content') || null;

    // Prefer semantic containers, fall back to the div with the most paragraph text.
    let text = '';
    for (const sel of ['article', 'main', '[role="main"]', '.content', '#content']) {
        const container = $(sel).first();
        if (container.length) {
            text = container.find('p, li, h1, h2, h3, h4')
                .map((_, el) => $(el).text().trim())
                .get().filter(Boolean).join('\n');
            if (text.length >= 200) break;
        }
    }
    if (!text || text.length < 200) {
        let best = '', bestLen = 0;
        $('div, section').each((_, el) => {
            const t = $(el).find('p')
                .map((_, p) => $(p).text().trim())
                .get().filter(Boolean).join('\n');
            if (t.length > bestLen) { bestLen = t.length; best = t; }
        });
        if (bestLen > text.length) text = best;
    }

    return { title: title.trim(), text: text.trim(), imageUrl };
}
