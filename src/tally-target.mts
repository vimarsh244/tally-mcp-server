/**
 * The Tally instance the current request talks to.
 *
 * A Windows Server runs one copy of Tally per logged in user, and each copy
 * needs its own XML port. One process therefore has to reach several of them,
 * so the target cannot stay a single value read from the environment.
 *
 * The route handler puts the target in an AsyncLocalStorage store and the
 * Tally client reads it back. Nothing in between has to pass it along, so the
 * tool modules are untouched and the stdio entry point keeps working with no
 * store at all: currentTallyTarget() falls back to the configured values.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.mjs';

export interface TallyTarget {
    host: string;
    port: number;
    /** Milliseconds to wait for a reply. */
    timeout: number;
}

const storage = new AsyncLocalStorage<TallyTarget>();

/** The target from the environment, used whenever no store is active. */
export function defaultTallyTarget(): TallyTarget {
    return { host: config.tallyHost, port: config.tallyPort, timeout: config.tallyTimeout };
}

export function runWithTallyTarget<T>(target: TallyTarget, fn: () => T): T {
    return storage.run(target, fn);
}

export function currentTallyTarget(): TallyTarget {
    return storage.getStore() ?? defaultTallyTarget();
}
