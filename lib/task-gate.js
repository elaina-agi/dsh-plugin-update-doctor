export class TaskGate {
    constructor(agents, { timeoutMs = 30 * 60_000 } = {}) {
        this.agents = agents; this.timeoutMs = timeoutMs; this.active = false; this.closed = false;
        this.current = null; this.claims = []; this.stop = new AbortController(); this.inFlight = false; this.activity = new WeakMap();
    }
    async beforeStep({ signal } = {}) {
        // New agents may be created by the replacement's apply(). Do not block
        // their creation; defer their first model/tool step instead.
        if (this.active && this.current) await abortable(this.current.promise, signal);
    }
    observeStatus({ agent, status }) {
        const prior=this.activity.get(agent) ?? { epoch:0, status:agent.status };
        this.activity.set(agent, { status, epoch: prior.epoch + (status==='running' && prior.status!=='running' ? 1 : 0) });
    }
    cancellationTargets() {
        return (this.agents?.list?.() ?? []).filter(agent=>agent.status==='running').map(agent=>({ agent, epoch:this.activity.get(agent)?.epoch ?? 0 }));
    }
    async run(operation, { signal, onWaiting, taskPolicy = 'wait-for-idle', confirmCancel = false, onCancelled, cancelTargets } = {}) {
        if (!['wait-for-idle','cancel-active'].includes(taskPolicy)) throw new Error('invalid-task-policy');
        if (taskPolicy === 'cancel-active' && confirmCancel !== true) throw new Error('task-cancellation-confirmation-required');
        if (!this.agents?.list || this.closed) throw new Error('task-gate-unavailable');
        if (this.inFlight) throw new Error('task-gate-busy');
        this.inFlight = true;
        const deadline = AbortSignal.timeout(this.timeoutMs);
        const combined = AbortSignal.any([this.stop.signal, deadline, ...(signal ? [signal] : [])]);
        try {
            if (taskPolicy === 'cancel-active') {
                combined.throwIfAborted();
                const running = this.agents.list().filter(agent => agent.status === 'running' && (!cancelTargets || cancelTargets.some(target=>target.agent===agent && target.epoch===(this.activity.get(agent)?.epoch ?? 0))));
                let requested = 0, failed = false;
                try {
                    for (const agent of running) {
                        // Standard user Stop: clear queued input and abort admitted work.
                        // A queue-write failure can still abort that task in the Host's finally.
                        requested++;
                        try { agent.cancel({ kind: 'user' }); }
                        catch (error) { failed = true; throw error; }
                    }
                } finally { onCancelled?.({ requestedAgents: requested, cancellationRequested: true, queueClear: failed ? 'unknown' : 'complete', cancelledSuccessfully: !failed }); }
            }
            while (true) {
                combined.throwIfAborted();
                // While waiting, existing parents can still create/finish child work.
                const agents = this.agents.list();
                onWaiting?.({ runningAgents: agents.filter(agent => agent.status === 'running').length, liveAgents: agents.length });
                await abortable(Promise.all(agents.map(agent => agent.whenIdle())), combined);
                combined.throwIfAborted();
                const claimAgents = this.agents.list();
                if (claimAgents.some(agent => typeof agent.runMaintenance !== 'function')) throw new Error('task-maintenance-unavailable');
                this.current = Promise.withResolvers(); this.active = true;
                let failed = false;
                // Capture this gate generation before calling the synchronous claim.
                // An Agent's own cancel/dispose ends only its claim, not this barrier.
                const released = this.current.promise;
                for (const agent of claimAgents) {
                    try { const task = agent.runMaintenance(signal => waitForClaimRelease(released, signal)); task.catch(()=>{}); this.claims.push(task); }
                    catch { failed = true; break; }
                }
                if (failed) { await this.release(); continue; }
                try { combined.throwIfAborted(); return await operation(combined); }
                finally { await this.release(); }
            }
        } finally { await this.release(); this.inFlight = false; }
    }
    async release() {
        this.active = false;
        const current = this.current; this.current = null; current?.resolve();
        const claims = this.claims.splice(0); await Promise.allSettled(claims);
    }
    dispose() { this.closed = true; this.stop.abort(new Error('task-gate-disposed')); }
}
// This maintenance callback owns no work beyond the reservation. Every local
// abort releases it: a prior user cancel cannot acquire a later disposed reason.
// Do not call gate.release() here; unrelated claims and beforeStep must stay held.
async function waitForClaimRelease(released, signal) {
    try { await abortable(released, signal); }
    catch (error) { if (!signal?.aborted) throw error; }
}
async function abortable(promise, signal) {
    if (!signal) return promise;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new Error('aborted'));
        signal.addEventListener('abort', abort, { once: true });
        promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
}
