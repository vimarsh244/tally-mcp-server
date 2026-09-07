/**
 * Environment configuration, read once in one place.
 *
 * server.mts used to read process.env at module top level while importing
 * dotenv without ever calling config(). It worked only because mcp.mts
 * happened to be imported first and called dotenv.config() as a side effect.
 * Loading here, before any consumer reads a value, removes that ordering trap.
 */

import dotenv from 'dotenv';

dotenv.config({ override: true, quiet: true });

const toInt = (value: string | undefined, fallback: number): number => {
    const parsed = parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
    /** Tally XML server, see Help (F1) > Settings > Connectivity in Tally. */
    tallyHost: process.env.TALLY_HOST || 'localhost',
    tallyPort: toInt(process.env.TALLY_PORT, 9000),
    /** Milliseconds to wait for Tally before giving up. */
    tallyTimeout: toInt(process.env.TALLY_TIMEOUT, 120000),

    /** Hides the write tools when set to '1'. */
    blockWrite: process.env.BLOCK_WRITE === '1',

    /** HTTP transport only. */
    port: toInt(process.env.PORT, 3000),
    domain: process.env.MCP_DOMAIN || 'http://localhost:3000',
    password: process.env.PASSWORD || 'password',

    /** How long a cached result table survives before it is dropped. */
    cacheTableTtlMs: toInt(process.env.CACHE_TABLE_TTL_MS, 15 * 60 * 1000),
} as const;
