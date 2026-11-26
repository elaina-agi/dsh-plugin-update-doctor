import { parseDocument } from 'yaml';

const MAX_PATCH = 256_000, MAX_EXPRESSION = 8_192, MAX_OVERRIDES = 64, MAX_ROWS = 400, MAX_DEPTH = 4, MAX_ID = 200;
const JS_TAG = Object.freeze({ tag: 'tag:yaml.org,2002:js', resolve: value => ({ __declarativeJs: value }) });
const declarative = value => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && typeof value.__declarativeJs === 'string' && value.__declarativeJs.length <= MAX_EXPRESSION;
const OVERRIDE_KEYS = Object.freeze(['id', 'disabled', 'config']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/;

/** Core Host rows. Only a *new* one relative to the installed version is a capability change. */
export const CORE_SERVICE_ROW = /^(?:subprocess|fs-sandbox|directory-picker|agent-loop|hmr|plugin-manager|storage|session|tool-working-directory)$/;

/**
 * Static read of a bundle patch, for evidence only.
 *
 * The standard channel trusts published package code, so this parser records the
 * declared rows and existing-row overrides instead of judging their shape: group
 * rows, nested children, relative module paths and suite rows are all normal DSH
 * patches. Admission compares this footprint with the installed version, so an
 * update may keep the capabilities it already had and never gain a new core one.
 * `declarative` keeps `!!js` values as inert data; `allowOverride` records
 * existing-row overrides so the caller can compare them.
 */
export function inspectPatchEntries(texts, packageName, { declarative: allowDeclarative = false, allowOverride = false } = {}) {
    const rows = [], overrides = [], ids = new Set();
    const remember = row => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('unsupported-bundle-patch');
        if (typeof row.id !== 'string' || !ID.test(row.id) || row.id.length > MAX_ID || ids.has(row.id)) throw new Error('duplicate-or-invalid-row');
        if (typeof row.name !== 'string' || !row.name.length || row.name.length > 512) throw new Error('unsupported-bundle-patch');
        if (row.disabled !== undefined && typeof row.disabled !== 'boolean' && !(allowDeclarative && declarative(row.disabled))) throw new Error('unsupported-row-expression');
        if (row.insert !== undefined) throw new Error('unsupported-bundle-patch');
        ids.add(row.id);
        rows.push({ id: row.id, name: row.name, ...(row.group === true ? { group: true } : {}) });
        if (rows.length > MAX_ROWS) throw new Error('unsupported-bundle-patch');
    };
    const walk = (declarations, depth) => {
        if (!Array.isArray(declarations) || depth > MAX_DEPTH) throw new Error('unsupported-bundle-patch');
        for (const row of declarations) {
            remember(row);
            // A group row may declare child rows inline; they are rows like any other.
            if (Array.isArray(row.config)) walk(row.config, depth + 1);
        }
    };
    for (const text of texts) {
        if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_PATCH || /!<|\b(?:include|extends):/i.test(text)
            || (!allowDeclarative && /!!/.test(text))) throw new Error('dynamic-or-included-patch-unsupported');
        const document = parseDocument(text, { uniqueKeys: true, maxAliasCount: 0, schema: 'core',
            ...(allowDeclarative ? { customTags: [JS_TAG] } : {}) });
        if (document.errors.length || document.warnings.length) throw new Error('invalid-or-tagged-bundle-patch');
        const entries = document.toJS({ maxAliasCount: 0 });
        if (!Array.isArray(entries) || entries.length > 200) throw new Error('unsupported-bundle-patch');
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('unsupported-bundle-patch');
            if (entry.insert !== undefined && !Array.isArray(entry.insert)) throw new Error('unsupported-bundle-patch');
            if (Array.isArray(entry.insert)) {
                if (Object.keys(entry).some(key => key !== 'insert')) throw new Error('unsupported-bundle-patch');
                walk(entry.insert, 0);
                continue;
            }
            if (!allowOverride) throw new Error('existing-row-override-unsupported');
            if (Object.keys(entry).some(key => !OVERRIDE_KEYS.includes(key))) throw new Error('unsupported-row-override');
            if (typeof entry.id !== 'string' || !ID.test(entry.id) || entry.id.length > MAX_ID) throw new Error('unsupported-row-override');
            if (entry.disabled !== undefined && typeof entry.disabled !== 'boolean' && !(allowDeclarative && declarative(entry.disabled))) throw new Error('unsupported-row-expression');
            if (entry.config !== undefined && (!entry.config || typeof entry.config !== 'object' || Array.isArray(entry.config))) throw new Error('unsupported-row-override');
            if (overrides.length >= MAX_OVERRIDES || overrides.some(value => value.id === entry.id)) throw new Error('unsupported-row-override');
            overrides.push({ id: entry.id, ...(entry.disabled !== undefined ? { disabled: entry.disabled } : {}),
                ...(entry.config !== undefined ? { config: entry.config } : {}) });
        }
    }
    if (!rows.length) throw new Error('empty-plugin-bundle');
    return { rows, overrides };
}

/** Insert-only view used by paths that must refuse existing-row overrides outright. */
export function inspectPatches(texts, packageName, options = {}) {
    return inspectPatchEntries(texts, packageName, options).rows;
}
