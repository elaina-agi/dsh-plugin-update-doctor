import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Build the verifier that proves a freshly generated package is the code the Loader
 * actually runs. Construction reads nothing and executes no package code.
 * @param entries Current Loader entries, read at verification time.
 * @param resolveShared Resolve a Host-provided shared runtime package from a module URL.
 * @returns A verifier returning true only for the exact running generation namespace.
 */
export function createRunningGenerationVerifier({ entries, resolveShared }) {
    return async function verifyRunningGeneration(directory, reference, { enabled, packageName } = {}) {
        const entry = [...entries()].find(value => value.options.name === packageName);
        if (enabled === false) return !entry?.fiber || entry.disabled === true;
        if (!entry?.moduleNamespace) return false;
        const originalEntry = pathToFileURL(join(directory, reference.runtimeGeneration.generation, 'lib/index.js')).href;
        const namespace = await import(originalEntry);
        if (entry.moduleNamespace !== namespace) return false;
        const sharedPath = resolveShared('@deepseek-ai/schemastery', originalEntry);
        const shared = await import(pathToFileURL(sharedPath).href);
        const generation = reference.runtimeGeneration.generation;
        if (sharedPath.includes(generation + '/node_modules/') || sharedPath.includes(generation.replaceAll('/', '\\') + '\\node_modules\\')) return false;
        return typeof namespace.Config === 'function' && Object.getPrototypeOf(namespace.Config) === shared.default.prototype;
    };
}
