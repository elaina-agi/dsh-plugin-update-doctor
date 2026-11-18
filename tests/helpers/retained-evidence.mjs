import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Only absent private local evidence skips; unreadable or invalid retained evidence fails. */
export async function retainedEvidence(t, file, { reproduce, required = [] } = {}) {
    let text;
    try {
        text = await readFile(file, 'utf8');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        t.skip(`Private local experiment results are not included in this checkout. ${reproduce ?? 'Run the corresponding isolated experiment to create them.'}`);
        return null;
    }
    const evidence = JSON.parse(text);
    assert(evidence !== null && typeof evidence === 'object' && !Array.isArray(evidence), 'Retained evidence must be a JSON object');
    evidenceFields(evidence, required);
    return evidence;
}

/** Presence checks prevent absent facts from passing undefined equality or vacuous array assertions. */
export function evidenceFields(value, paths) {
    for (const path of paths) {
        let current = value;
        for (const field of path.split('.')) {
            assert(current !== null && typeof current === 'object' && Object.hasOwn(current, field), `Retained evidence is missing required field: ${path}`);
            current = current[field];
        }
        assert.notEqual(current, undefined, `Retained evidence field is undefined: ${path}`);
    }
}
