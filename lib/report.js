/**
 * User-facing diagnostic report. The report is deliberately explicit about its fields:
 * it contains versions, error codes, bounded sanitized messages and steps, never raw
 * profile paths, package contents, tokens or session data. This is the document a user
 * copies when reporting a problem, so its shape is stable and machine-readable.
 */
export const REPORT_SCHEMA = 'dsh-plugin-update-doctor/report/v1';
const MAX_OPERATIONS = 6;
const MAX_ITEMS = 20;
const MAX_STEPS = 60;
const MAX_TEXT = 8_000;
const MAX_INSTALL_LOG = 24_000;
const MAX_REPORT_BYTES = 200_000;
const TRUNCATED = '\n<report-truncated>';
const clip = (value, limit = MAX_TEXT) => typeof value === 'string' && value.length > limit ? value.slice(0, limit) + TRUNCATED : (typeof value === 'string' ? value : undefined);
const pick = (value, keys) => {
    const result = {};
    for (const key of keys) {
        const item = value?.[key];
        if (item === undefined || item === null) continue;
        if (typeof item === 'string') result[key] = clip(item);
        else if (typeof item === 'number' || typeof item === 'boolean') result[key] = item;
        else if (Array.isArray(item)) result[key] = item.slice(0, 40).map(entry => clip(entry, 300)).filter(entry => entry !== undefined);
    }
    return result;
};
const resultOf = value => {
    if (!value || typeof value !== 'object') return undefined;
    return {
        ...pick(value, ['application', 'stage', 'observedApplication', 'changed', 'restartReason']),
        ...(value.error ? { error: pick(value.error, ['code', 'diagnostic']) } : {}),
        ...(value.packageResult ? { packageResult: pick(value.packageResult, ['exitCode', 'kind', 'timedOut', 'truncated', 'output']) } : {}),
    };
};
const itemOf = (value, { withLog = false } = {}) => {
    if (!value || typeof value !== 'object') return undefined;
    const item = {
        ...pick(value, ['name', 'from', 'to', 'status', 'origin', 'installMode', 'sourceMode', 'runtimePackaging', 'diagnostic']),
        ...(value.result ? { result: resultOf(value.result) } : {}),
        ...(value.restore ? { restore: resultOf(value.restore) } : {}),
        ...(value.verification ? { verification: verificationOf(value.verification) } : {}),
        ...(value.restoreVerification ? { restoreVerification: verificationOf(value.restoreVerification) } : {}),
        ...(['registryOutcomeUnknown', 'unionOutcomeUnknown', 'wslOutcomeUnknown', 'interrupted'].reduce((flags, key) => {
            if (value[key] === true) flags[key] = true;
            return flags;
        }, {})),
    };
    if (withLog && typeof value.result?.completeInstallLog === 'string') item.installLog = clip(value.result.completeInstallLog, MAX_INSTALL_LOG);
    if (withLog && value.result?.completeInstallLogUnavailable === true) item.installLogUnavailable = true;
    return item;
};
const verificationOf = value => {
    if (!value || typeof value !== 'object') return undefined;
    const statuses = {};
    for (const key of ['package', 'source', 'host', 'runtime', 'dependency']) {
        if (value[key] && typeof value[key] === 'object') statuses[key] = value[key].status ?? 'unknown';
    }
    return statuses;
};
const stepsOf = value => Array.isArray(value) ? value.slice(-MAX_STEPS).map(step => typeof step === 'string'
    ? clip(step, 200) : { step: clip(step?.step, 200), time: clip(step?.time, 40) }) : [];

/** Compact one stored or live operation for the report. */
export function reportOperation(record, { name, live = false } = {}) {
    if (!record || typeof record !== 'object') return null;
    const items = Array.isArray(record.items) ? record.items.filter(item => !name || item?.name === name) : [];
    const item = !items.length && record.item?.name === name ? record.item : undefined;
    return {
        id: clip(record.id, 80), operation: clip(record.operation, 40), origin: clip(record.origin, 40),
        phase: clip(record.phase, 40), outcome: clip(record.outcome, 40), live,
        ...(record.taskPolicy ? { taskPolicy: clip(record.taskPolicy, 40) } : {}),
        startedAt: clip(record.startedAt, 40), finishedAt: clip(record.finishedAt, 40),
        steps: stepsOf(record.steps),
        items: (items.length ? items : item ? [item] : []).slice(0, MAX_ITEMS).map((value, index) => itemOf(value, { withLog: index === 0 })),
        ...(record.error ? { error: clip(record.error) } : {}),
        ...(record.diagnostic ? { diagnostic: clip(record.diagnostic) } : {}),
        ...(record.summary ? { summary: clip(record.summary) } : {}),
        ...(record.truncation ? { truncated: true } : {}),
    };
}

/** Assemble the bounded report. Callers redact before serializing to users. */
export function buildReport({ generatedAt, doctorVersion, runtimeVersion, host, profile, persistence, restart, subject, classification, recovery, identity, operations = [], failures = [], notes = [] } = {}) {
    const report = {
        schema: REPORT_SCHEMA,
        generatedAt: clip(generatedAt, 40),
        doctor: { version: clip(doctorVersion, 40), runtimeVersion: clip(runtimeVersion, 80) },
        host: pick(host, ['node', 'electron', 'platform', 'arch']),
        profile: clip(profile, 80),
        persistence: pick(persistence, ['warning', 'truncationWarning', 'failureLogWarning']),
        restart: restart ? {
            pending: restart.pending ? pick(restart.pending, ['name', 'from', 'to', 'installMode', 'origin']) : null,
            last: restart.last ? { ...pick(restart.last, ['name', 'from', 'to', 'outcome', 'result']), ...(restart.last.verified !== undefined ? { verified: restart.last.verified } : {}) } : null,
        } : undefined,
        subject: subject ? pick(subject, ['name', 'version', 'sourceKind', 'installed', 'enabled', 'state', 'activeRows', 'totalRows', 'canUpdate', 'runtimePackaging', 'reasons']) : null,
        classification: classification ? {
            code: clip(classification.code, 80), title: clip(classification.title, 200),
            detail: clip(classification.detail, 2_000),
            nextSteps: Array.isArray(classification.nextSteps) ? classification.nextSteps.slice(0, 8).map(step => clip(step, 300)) : [],
        } : null,
        recovery: recovery ? pick(recovery, ['status', 'from', 'to', 'installMode']) : null,
        identity: identity ? pick(identity, ['version', 'installMode', 'status']) : null,
        operations: operations.filter(Boolean).slice(0, MAX_OPERATIONS),
        failures: failures.filter(Boolean).slice(0, MAX_OPERATIONS).map(failure => ({
            id: clip(failure.id, 80), time: clip(failure.time, 40), package: clip(failure.package),
            operation: clip(failure.operation, 40), phase: clip(failure.phase, 40), status: clip(failure.status, 40), outcome: clip(failure.outcome, 40),
            from: clip(failure.from), to: clip(failure.to), installMode: clip(failure.installMode),
            error: failure.error ? { code: clip(failure.error.code, 200), diagnostic: clip(failure.error.diagnostic) } : null,
            result: failure.result ?? null, restore: failure.restore ? { application: clip(failure.restore.application),
                ...(failure.restore.error ? { error: { code: clip(failure.restore.error.code, 200), diagnostic: clip(failure.restore.error.diagnostic) } } : {}) } : null,
            verification: failure.verification ?? null, steps: Array.isArray(failure.steps) ? failure.steps.slice(-20) : [],
        })),
        notes: notes.map(note => clip(note, 500)),
    };
    const size = () => Buffer.byteLength(JSON.stringify(report), 'utf8');
    while (size() > MAX_REPORT_BYTES && report.operations.length > 1) report.operations.pop();
    if (size() > MAX_REPORT_BYTES) for (const operation of report.operations) {
        for (const item of operation.items ?? []) for (const key of ['installLog']) if (item[key]) delete item[key];
        for (const key of ['diagnostic', 'summary', 'error']) if (typeof operation[key] === 'string') operation[key] = clip(operation[key], 2_000);
        for (const item of operation.items ?? []) {
            if (item.diagnostic) item.diagnostic = clip(item.diagnostic, 2_000);
            if (item.result?.error?.diagnostic) item.result.error.diagnostic = clip(item.result.error.diagnostic, 2_000);
            if (item.restore?.error?.diagnostic) item.restore.error.diagnostic = clip(item.restore.error.diagnostic, 2_000);
        }
    }
    if (size() > MAX_REPORT_BYTES) for (const failure of report.failures) {
        if (failure.error?.diagnostic) failure.error.diagnostic = clip(failure.error.diagnostic, 2_000);
        if (failure.restore?.error) failure.restore.error.diagnostic = clip(failure.restore.error.diagnostic, 2_000);
    }
    while (size() > MAX_REPORT_BYTES && report.failures.length > 1) report.failures.pop();
    if (size() > MAX_REPORT_BYTES) report.operations = report.operations.slice(0, 1);
    return report;
}
