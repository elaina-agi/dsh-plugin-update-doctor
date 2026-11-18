import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { RegistryStager } from '../../lib/staging.js';
import { DoctorService } from '../../lib/service.js';
import { TaskGate } from '../../lib/task-gate.js';

export function tar(entries) {
    const parts = [];
    for (const [name, text] of entries) {
        const bytes = Buffer.from(text), h = Buffer.alloc(512);
        h.write(name, 0, 100); h.write('0000644\0', 100); h.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); h.fill(32, 148, 156); h[156] = 48; h.write('ustar\0', 257);
        h.write([...h].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148); parts.push(h, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
    }
    parts.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(parts));
}
export async function serviceFixture(t, { names = ['sample-plugin'], failTarget = false, failRestore = false, gate } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'dsh-v3-test-')); t.after(() => rm(root, { recursive: true, force: true }));
    const bundles = names.map(name => ({ name, version: '1.0.0', source: name + '@1.0.0', installed: true, enabled: true, removable: true, availability: 'profile', update: 'registry', rows: [{ rowId: name + '-feature', moduleName: name, entryId: 'include:' + name + '-feature' }] }));
    const calls = []; const state = { failTarget, failRestore, registry: 'https://registry.npmjs.org', afterRemove: null, afterInstall: null };
    for (const bundle of bundles) { await mkdir(join(root, bundle.name)); await writeFile(join(root, bundle.name, 'package.json'), JSON.stringify({ name: bundle.name, version: bundle.version, dsh: { bundle: { patch: 'cordis.patch.yml' } } })); }
    const stager = new RegistryStager(join(root, 'cache', 'dsh-plugin-update-doctor', 'test', 'staged'), { fetcher: async url => {
        const parsed = new URL(url), segments = parsed.pathname.split('/').filter(Boolean), name = decodeURIComponent(segments[0]);
        const version = parsed.pathname.endsWith('.tgz') ? /-(\d+\.\d+\.\d+)\.tgz$/.exec(parsed.pathname)[1] : segments[1];
        const manifest = { name, version, type: 'module', exports: { '.': './index.js' }, dsh: { bundle: { patch: 'cordis.patch.yml' } } };
        const bytes = tar([['package/package.json', JSON.stringify(manifest)], ['package/cordis.patch.yml', '- insert:\n    - id: ' + name + '-feature\n      name: ' + name + '\n'], ['package/index.js', 'export function apply(){}']]);
        return parsed.pathname.endsWith('.tgz') ? new Response(bytes) : Response.json({ ...manifest, dist: { tarball: 'https://registry.npmjs.org/' + name + '/-/' + name + '-' + version + '.tgz', integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') } });
    } });
    for (const bundle of bundles) {
        const original = await stager.stage(bundle.name, bundle.version);
        await writeFile(join(root, bundle.name, 'package.json'), JSON.stringify(original.manifest));
        await writeFile(join(root, bundle.name, 'cordis.patch.yml'), '- insert:\n    - id: ' + bundle.name + '-feature\n      name: ' + bundle.name + '\n');
        await writeFile(join(root, bundle.name, 'index.js'), 'export function apply(){}');
    }
    const manager = {
        listBundles: async () => structuredClone(bundles),
        listPlugins: async () => bundles.filter(b => b.installed).map(b => ({ entryId: 'include:' + b.name + '-feature', patchId: b.name + '-feature', moduleName: b.name, enabled: b.enabled, fiberPhase: b.failed ? 'failed' : 'active' })),
        listVersions: async name => ({ status: 'listed', registry: state.registry, installed: bundles.find(b => b.name === name).version, versions: [{ version: '1.1.0', bundle: true }, { version: '2.0.0', bundle: true, incompatible: { requirements: { dsh: '99' } } }] }),
        removeBundle: async name => { calls.push(['remove', name]); const b = bundles.find(b => b.name === name); b.installed = false; b.enabled = false; b.rows = []; state.afterRemove?.(b); return { application: 'applied', stage: 'remove' }; },
        installBundle: async (path, options) => { calls.push(['install', options.expected.name + '@' + options.expected.version, options.requestId]); const b = bundles.find(b => b.name === options.expected.name); Object.assign(b, { installed: true, version: options.expected.version, enabled: options.enabled, source: 'file:' + path, update: undefined, rows: [{ rowId: b.name + '-feature', moduleName: b.name, entryId: 'include:' + b.name + '-feature' }] }); b.failed = options.expected.version === '1.1.0' ? state.failTarget : state.failRestore; state.afterInstall?.(b); return { application: b.failed ? 'failed' : 'applied', stage: 'enable', version: b.version, bundle: b.name, error: b.failed ? { code: 'operation-error', diagnostic: 'fixture activation failed password=hidden' } : undefined }; },
    };
    const taskGate = gate ?? new TaskGate({ list: () => [] });
    const service = new DoctorService({ manager, profile: { dir: root, home: root, name: 'test' }, runtimeVersion: '0.2.2-rc.3', resolvePackage: async name => join(root, name), probeLocks: async () => ({ status: 'checked', files: [] }), statePath: join(root, 'cache', 'dsh-plugin-update-doctor', 'test', 'history.json'), taskGate, stager });
    await service.initialize(); t.after(() => service.dispose());
    return { root, service, manager, stager, bundles, calls, state };
}
