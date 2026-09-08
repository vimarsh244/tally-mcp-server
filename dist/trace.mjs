/**
 * Timing of one tool call, broken down by stage.
 *
 * The benchmark could say a ledger history took three and a half seconds but
 * not where the time went, so every explanation of it was a guess. A trace
 * records how long each stage took, and the record says whether the stages add
 * up to the wall time or whether something outside them is missing.
 *
 * Nothing but stage names, durations and sizes is recorded. No company name, no
 * ledger name, no narration, no XML, no credential. Off unless TRACE=1.
 */
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.mjs';
const storage = new AsyncLocalStorage();
/** A monotonic clock, so a change of the system clock cannot produce a negative span. */
const now = () => process.hrtime.bigint();
const msSince = (from) => Math.round(Number(now() - from) / 1e3) / 1e3;
/** Adds a finished stage to the trace in progress, if there is one. */
export function record(name, ms, detail = {}) {
    storage.getStore()?.spans.push({ name, ms, ...detail });
}
/** Measures one stage. The detail is read from the result, so it costs nothing when tracing is off. */
export async function timed(name, work, detail) {
    if (!storage.getStore())
        return work();
    const started = now();
    try {
        const result = await work();
        record(name, msSince(started), detail?.(result));
        return result;
    }
    catch (err) {
        record(name, msSince(started), { failed: true });
        throw err;
    }
}
/**
 * Runs one tool call under a trace and emits the record when it finishes.
 *
 * The spans are sequential work, so their total is compared with the wall time
 * and the difference is reported rather than hidden. Anything unaccounted for
 * is real, it is simply not measured yet.
 */
export async function runTraced(tool, work) {
    if (!config.trace)
        return work();
    const context = { id: crypto.randomUUID(), tool, started: now(), spans: [] };
    const emit = (failed) => {
        const totalMs = msSince(context.started);
        const spanMs = Math.round(context.spans.reduce((sum, span) => sum + span.ms, 0) * 1e3) / 1e3;
        // stderr, so a stdio transport keeps its protocol stream clean
        console.error(JSON.stringify({
            trace: context.id,
            tool,
            totalMs,
            spanMs,
            unaccountedMs: Math.round((totalMs - spanMs) * 1e3) / 1e3,
            failed,
            spans: context.spans,
        }));
    };
    return storage.run(context, async () => {
        try {
            const result = await work();
            emit(false);
            return result;
        }
        catch (err) {
            emit(true);
            throw err;
        }
    });
}
//# sourceMappingURL=trace.mjs.map