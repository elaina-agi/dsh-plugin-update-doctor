import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('primary and disabled buttons use readable Host theme foreground pairs', async () => {
    const code=await readFile(new URL('../client.js',import.meta.url),'utf8');
    assert(code.includes('.pud-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)'));
    assert(!code.includes('color:var(--dsw-alias-label-on-color)'));
    assert(code.includes('.pud-btn:disabled{opacity:1;'));
    assert(code.includes("t(pending === 'scan' ? 'scanning' : 'scan')"));
});
test('task cancellation option defaults to wait and requires separate acknowledgement', async()=>{
    const code=await readFile(new URL('../client.js',import.meta.url),'utf8');
    assert(code.includes("useState('wait-for-idle')"));
    assert(code.includes('confirmCancel'));
    assert(code.includes('stopConsent'));
    assert(code.includes("taskPolicy === 'cancel-active'"));
});
