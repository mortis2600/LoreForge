// Epub adapter: ingests books from .epub files (Dan's own library).
// Chapters become listable items, exactly like wiki pages in the other
// adapters. The ingest pipeline and LLM structuring stay adapter-agnostic.
//
// listItems() parses the OPF spine and returns one item per chapter.
// fetchItem() returns the chapter's plain text (HTML stripped).
//
// Source config shape:
//   { "adapter": "epub", "epub_path": "/abs/path/to/book.epub",
//     "book": 1, "floor": 1, "display_name": "Dungeon Crawler Carl, Book 1" }

import fs from 'fs';
import JSZip from 'jszip';

export const name = 'epub';

function stripHtml(htmlText) {
    return htmlText
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

async function loadSpine(epubPath) {
    const data = fs.readFileSync(epubPath);
    const zip = await JSZip.loadAsync(data);

    const containerXml = await zip.file('META-INF/container.xml').async('string');
    const rootfile = containerXml.match(/full-path="([^"]+)"/)?.[1];
    if (!rootfile) throw new Error('Could not find OPF rootfile in epub');

    const opfDir = rootfile.includes('/') ? rootfile.slice(0, rootfile.lastIndexOf('/') + 1) : '';
    const opf = await zip.file(rootfile).async('string');

    const manifest = {};
    for (const m of opf.matchAll(/<item\s+[^>]*>/g)) {
        const tag = m[0];
        const id = tag.match(/id="([^"]+)"/)?.[1];
        const href = tag.match(/href="([^"]+)"/)?.[1];
        const mediaType = tag.match(/media-type="([^"]+)"/)?.[1] || '';
        if (id && href) manifest[id] = { href: opfDir + href, mediaType };
    }

    const spineBlock = opf.match(/<spine[\s\S]*?<\/spine>/)?.[0] || '';
    const spineIds = [...spineBlock.matchAll(/<itemref\s+[^>]*idref="([^"]+)"/g)].map(m => m[1]);

    return { zip, manifest, spineIds };
}

async function chapterTitle(zip, href) {
    try {
        const raw = await zip.file(href).async('string');
        const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
        if (title) return stripHtml(title).slice(0, 120) || null;
    } catch { /* fall through */ }
    return null;
}

export async function listItems(source) {
    const { zip, manifest, spineIds } = await loadSpine(source.epub_path);
    const items = [];
    let n = 0;
    for (const id of spineIds) {
        const entry = manifest[id];
        if (!entry) continue;
        // Only content documents (skip cover images etc.)
        if (!/xhtml|html/i.test(entry.mediaType)) continue;
        n += 1;
        const title = (await chapterTitle(zip, entry.href)) || `Chapter ${n}`;
        items.push({ ref: entry.href, title });
    }
    return { items };
}

export async function fetchItem(source, item) {
    const { zip, manifest, spineIds } = await loadSpine(source.epub_path);
    // item.ref is the chapter href; find the zip entry directly.
    let file = zip.file(item.ref);
    if (!file) {
        // Fallback: resolve via spine/manifest in case ref was an id.
        const entry = manifest[item.ref];
        file = entry ? zip.file(entry.href) : null;
    }
    if (!file) throw new Error(`Chapter not found in epub: ${item.ref}`);
    const raw = await file.async('string');
    const text = stripHtml(raw);
    return { title: item.title, text, imageUrl: null };
}
