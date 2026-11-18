import { parseDocument } from 'yaml';

/** Static bundle safety preflight. Dynamic expressions, nested includes and overriding existing rows require separate review. */
export function inspectPatches(texts, packageName) {
    const ids = new Set(); const rows = [];
    const PROTECTED = /^(?:include|hmr|plugin-manager|plugin-update-doctor|agent-loop|agent|session|storage|subprocess|fs-sandbox|directory-picker|tool-working-directory)(?:$|[-/])/;
    for (const text of texts) {
        if (typeof text !== 'string' || Buffer.byteLength(text) > 256_000 || /!!|!<|\b(?:include|extends):/i.test(text)) throw new Error('dynamic-or-included-patch-unsupported');
        const document = parseDocument(text, { uniqueKeys: true, maxAliasCount: 0, schema: 'core' });
        if (document.errors.length || document.warnings.length) throw new Error('invalid-or-tagged-bundle-patch');
        const entries = document.toJS({ maxAliasCount: 0 });
        if (!Array.isArray(entries) || entries.length > 200) throw new Error('unsupported-bundle-patch');
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object' || !Array.isArray(entry.insert) || Object.keys(entry).some(key => key !== 'insert')) throw new Error('existing-row-override-unsupported');
            for (const row of entry.insert) {
                if (!row || typeof row !== 'object' || typeof row.id !== 'string' || ids.has(row.id) || PROTECTED.test(row.id)) throw new Error('protected-or-duplicate-row');
                if (typeof row.name !== 'string' || (row.name !== packageName && !row.name.startsWith(packageName + '/')) || row.group || row.insert) throw new Error('foreign-or-nested-plugin-row');
                ids.add(row.id); rows.push({ id: row.id, name: row.name });
            }
        }
    }
    if (!rows.length) throw new Error('empty-plugin-bundle');
    return rows;
}
