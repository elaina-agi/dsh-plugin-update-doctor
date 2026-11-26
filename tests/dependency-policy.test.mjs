import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm,realpath,lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname,resolve,basename } from 'node:path';
import { rangeMatches, dependencyDeclaration, inspectDependencyGraph, assertSameDependencyGraph } from '../lib/dependency-policy.js';

async function fixture(t){
 const temp=await realpath(tmpdir()),root=await mkdtemp(join(temp,'dsh-dependency-policy-test-'));
 t.after(async()=>{const actual=await realpath(root);assert.equal(actual,resolve(root));assert.equal(dirname(actual),temp);assert(basename(actual).startsWith('dsh-dependency-policy-test-'));assert(!(await lstat(actual)).isSymbolicLink());await rm(actual,{recursive:true,force:true});});
 const packageDir=join(root,'plugin');await mkdir(packageDir);
 const manifest={name:'owned-plugin',version:'1.0.0',dependencies:{'owned-dep':'^1.0.0'},peerDependencies:{react:'^18.2.0'}};
 await writeFile(join(packageDir,'package.json'),JSON.stringify(manifest));
 const dependencyDir=join(packageDir,'node_modules','owned-dep');await mkdir(dependencyDir,{recursive:true});
 const value={name:'owned-dep',version:'1.0.0',main:'index.js'};
 await writeFile(join(dependencyDir,'package.json'),JSON.stringify(value));await writeFile(join(dependencyDir,'index.js'),'module.exports={};\n');
 return {root,packageDir,dependencyDir,manifest,value};
}

test('ordinary JS dependency declarations are admitted while graph bytes are independently bound',async t=>{
 const f=await fixture(t);
 const first=await inspectDependencyGraph(f.packageDir,f.manifest),second=await inspectDependencyGraph(f.packageDir,f.manifest);
 assert.equal(first.packageCount,1);assert.equal(first.packages[0].name,'owned-dep');assert.equal(first.packages[0].version,'1.0.0');assert.doesNotThrow(()=>assertSameDependencyGraph(first,second));
 await writeFile(join(f.dependencyDir,'index.js'),'module.exports={changed:true};\n');const changed=await inspectDependencyGraph(f.packageDir,f.manifest);
 assert.throws(()=>assertSameDependencyGraph(first,changed),error=>error.code==='dependency-graph-changed');
 assert(!JSON.stringify(first).includes(f.root));
});

test('changed direct dependency declarations do not inherit same-graph admission',()=>{
 const previous={dependencies:{x:'^1.0.0'},peerDependencies:{react:'^18.2.0'}};
 const reordered={peerDependencies:{react:'^18.2.0'},dependencies:{x:'^1.0.0'}};
 assert.equal(dependencyDeclaration(previous),dependencyDeclaration(reordered));
 assert.notEqual(dependencyDeclaration(previous),dependencyDeclaration({dependencies:{x:'^2.0.0'},peerDependencies:{react:'^18.2.0'}}));
 assert.throws(()=>assertSameDependencyGraph({declaration:dependencyDeclaration(previous),digest:'same'},{declaration:dependencyDeclaration({dependencies:{x:'^2.0.0'}}),digest:'same'}));
});

test('tolerant graph inspection records unresolved declarations instead of failing the update',async t=>{
 const f=await fixture(t);
 await assert.rejects(()=>inspectDependencyGraph(f.packageDir,{...f.manifest,dependencies:{'missing-library':'^1.0.0'}}),error=>error.code==='dependency-not-resolved');
 const graph=await inspectDependencyGraph(f.packageDir,{...f.manifest,optionalDependencies:{'platform-only':'^1.0.0'}},undefined,{tolerant:true});
 assert.equal(graph.packageCount,1);assert(graph.unresolved.some(entry=>entry.name==='platform-only'));
 const browser=await inspectDependencyGraph(f.packageDir,{...f.manifest,dependencies:{'browser-bundled':'^1.0.0'}},undefined,{tolerant:true});
 assert(browser.unresolved.some(entry=>entry.name==='browser-bundled'));
});

test('native bytes are recorded and dependency lifecycle scripts are left to pnpm approval', async t => {
 const f=await fixture(t);await writeFile(join(f.dependencyDir,'addon.node'),'owned inert fake native');
 const graph=await inspectDependencyGraph(f.packageDir,f.manifest);
 assert.deepEqual(graph.native,['owned-dep/addon.node'],'native payloads are evidence, and the Host checks decide whether the replacement loads');
 await rm(join(f.dependencyDir,'addon.node'));
 await writeFile(join(f.dependencyDir,'package.json'),JSON.stringify({...f.value,scripts:{postinstall:'echo unsafe'}}));
 const scripts=await inspectDependencyGraph(f.packageDir,f.manifest);
 assert.equal(scripts.packageCount,1,'pnpm refuses to run dependency build scripts by default, so this is evidence rather than a refusal');
});

test('root package version changes do not change dependency topology, range mismatches do',async t=>{
 const f=await fixture(t),before=await inspectDependencyGraph(f.packageDir,f.manifest),after=await inspectDependencyGraph(f.packageDir,{...f.manifest,version:'1.1.0'});
 assert.doesNotThrow(()=>assertSameDependencyGraph(before,after));
 assert(before.edges.some(edge=>edge.owner==='root:owned-plugin'&&edge.resolved==='owned-dep@1.0.0'));
 for(const range of ['>1','>=1.2','<1','<=0.9','>*','<*'])await assert.rejects(()=>inspectDependencyGraph(f.packageDir,{...f.manifest,dependencies:{'owned-dep':range}}),error=>error.code==='dependency-version-range-mismatch');
 await assert.rejects(()=>inspectDependencyGraph(f.packageDir,{...f.manifest,dependencies:{'owned-dep':'^2.0.0'}}),error=>error.code==='dependency-version-range-mismatch');
});

test('dependency traversal cancellation does not return successful graph evidence',async t=>{
 const f=await fixture(t),controller=new AbortController();controller.abort(new Error('owned cancelled'));
 await assert.rejects(()=>inspectDependencyGraph(f.packageDir,f.manifest,controller.signal),/owned cancelled/);
});


test('partial caret and tilde ranges are matched, not reported as mismatches', () => {
    assert.equal(rangeMatches('0.12.0', '^0.12'), true);
    assert.equal(rangeMatches('0.13.0', '^0.12'), false);
    assert.equal(rangeMatches('1.9.0', '^1.2'), true);
    assert.equal(rangeMatches('2.0.0', '^1.2'), false);
    assert.equal(rangeMatches('0.0.3', '^0.0.3'), true);
    assert.equal(rangeMatches('0.0.4', '^0.0.3'), false);
    assert.equal(rangeMatches('0.9.0', '^0'), true);
    assert.equal(rangeMatches('1.0.0', '^0'), false);
    assert.equal(rangeMatches('1.2.9', '~1.2'), true);
    assert.equal(rangeMatches('1.5.0', '~1.2'), false);
    assert.equal(rangeMatches('1.3.0', '~1.2'), false);
    assert.equal(rangeMatches('0.12.7', '~0.12'), true);
    assert.equal(rangeMatches('0.13.0', '~0.12'), false);
    assert.equal(rangeMatches('1.9.9', '1.*'), true);
    assert.equal(rangeMatches('2.0.0', '1.*'), false);
    assert.equal(rangeMatches('3.1.0', '^2.0.0 || ^3.0.0'), true);
});
