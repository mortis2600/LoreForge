// Escape user input before it goes into a RegExp. Prevents regex injection
// (ReDoS / match-everything) on the :name and search endpoints.
export function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
