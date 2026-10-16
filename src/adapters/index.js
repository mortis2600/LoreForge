// Adapter registry. A site adapter knows how to LIST ingestible items from a
// source and FETCH one item's raw content. The ingest pipeline, LLM
// structuring, and API are adapter-agnostic.
//
// To add a new site type, create a module exporting:
//   - name: string
//   - listItems(source, entityType) -> Promise<{ items: [{ ref, title }], patchedCategory? }>
//   - fetchItem(source, item)       -> Promise<{ title, text, imageUrl }>
// and register it below.

import * as mediawiki from './mediawiki.js';
import * as html from './html.js';
import * as epub from './epub.js';

const registry = {
    [mediawiki.name]: mediawiki,
    [html.name]: html,
    [epub.name]: epub
};

export function getAdapter(adapterName) {
    const adapter = registry[adapterName || 'mediawiki'];
    if (!adapter) {
        throw new Error(
            `Unknown adapter "${adapterName}". Available: ${Object.keys(registry).join(', ')}`
        );
    }
    return adapter;
}

export function listAdapters() {
    return Object.keys(registry);
}
