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

/** Published in the README, so it is treated as no password at all. */
export const DEFAULT_PASSWORD = 'password';

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
    /**
     * Address the HTTP server binds to. The Windows installer sets 127.0.0.1,
     * so the service is reachable from that machine only. The default keeps
     * every interface, which is what a public remote deployment needs.
     */
    bindHost: process.env.BIND_HOST || '0.0.0.0',
    domain: process.env.MCP_DOMAIN || 'http://localhost:3000',
    password: process.env.PASSWORD || DEFAULT_PASSWORD,
    /** Optional PKCS#12 certificate used when TLS terminates in this process. */
    tlsPfxPath: process.env.TLS_PFX_PATH || '',
    tlsPfxPassword: process.env.TLS_PFX_PASSWORD || '',

    /** Lifetime of an issued access token. */
    accessTokenTtlMs: toInt(process.env.ACCESS_TOKEN_TTL_MS, 60 * 60 * 1000),
    /** Lifetime of an issued refresh token. */
    refreshTokenTtlMs: toInt(process.env.REFRESH_TOKEN_TTL_MS, 30 * 24 * 60 * 60 * 1000),
    /** Upper bound on dynamically registered clients, so /register cannot exhaust memory. */
    maxRegisteredClients: toInt(process.env.MAX_REGISTERED_CLIENTS, 100),
    /** Failed password attempts allowed per address per window. */
    authAttemptLimit: toInt(process.env.AUTH_ATTEMPT_LIMIT, 10),
    authAttemptWindowMs: toInt(process.env.AUTH_ATTEMPT_WINDOW_MS, 15 * 60 * 1000),
    /** Set to '1' to start with the default password on a non-local domain. */
    allowDefaultPassword: process.env.ALLOW_DEFAULT_PASSWORD === '1',

    /** How long a cached result table survives before it is dropped. */
    cacheTableTtlMs: toInt(process.env.CACHE_TABLE_TTL_MS, 15 * 60 * 1000),

    /**
     * A small result is also returned inline, so the caller does not have to
     * spend a second round trip on query-database to read three rows. Set
     * INLINE_ROW_LIMIT to 0 to always answer with the table id alone.
     */
    inlineRowLimit: toInt(process.env.INLINE_ROW_LIMIT, 25),
    inlineByteLimit: toInt(process.env.INLINE_BYTE_LIMIT, 4096),

    /** Rows sent to PGlite in one INSERT. */
    cacheInsertBatchRows: toInt(process.env.CACHE_INSERT_BATCH_ROWS, 500),

    /**
     * Requests allowed to be in flight against one Tally instance at a time.
     * Tally answers one report at a time, so more than a few in parallel only
     * moves the queue from Tally into a longer wait for everyone.
     */
    tallyMaxConcurrent: toInt(process.env.TALLY_MAX_CONCURRENT, 4),

    /** Emits one structured timing record per tool call on stderr when set to '1'. */
    trace: process.env.TRACE === '1',

    /**
     * Turns on the profile registry and the setup page. One Windows Server runs
     * a copy of Tally per signed in user, each on its own XML port, so one
     * listener has to serve several of them. Off by default, which leaves the
     * single Tally deployment exactly as it was.
     */
    multiUser: process.env.MULTI_USER === '1',
    /** Where the profile registry and the admin token are kept. */
    dataDir: process.env.TALLY_MCP_DATA_DIR || '',
} as const;

/**
 * Host names the MCP endpoint answers to, used for DNS rebinding protection.
 *
 * A rebinding attack works by pointing an attacker owned name at a local
 * address, so the browser sends the attacker's name in the Host header.
 * Listing the loopback names is therefore safe, and it keeps direct and
 * reverse-proxied access working. ALLOWED_HOSTS adds more, comma separated.
 */
export function allowedHosts(domain: string = config.domain, port: number = config.port): string[] {
    const hosts = new Set<string>();

    try {
        // allowedHosts expects a host, so the configured URL must be reduced to one
        const url = new URL(domain);
        hosts.add(url.host);
        hosts.add(url.hostname);
    } catch {
        hosts.add(domain); // already a bare host
    }

    for (const loopback of ['localhost', '127.0.0.1', '[::1]']) {
        hosts.add(loopback);
        hosts.add(`${loopback}:${port}`);
    }

    for (const extra of (process.env.ALLOWED_HOSTS ?? '').split(','))
        if (extra.trim()) hosts.add(extra.trim());

    return [...hosts];
}

/** True when the deployment is reachable only from this machine. */
export function isLocalDomain(domain: string = config.domain): boolean {
    const [host] = allowedHosts(domain);
    const hostname = host?.split(':')[0] ?? '';
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '';
}

/**
 * The default password is published in the README, so it protects nothing on a
 * public deployment. Local use is unaffected.
 */
export function assertPasswordIsSafe(): void {
    // multi user mode switches the root realm off, so the shared password guards
    // nothing: every route is a profile with its own password
    if (config.multiUser) return;
    if (config.password !== DEFAULT_PASSWORD) return;
    if (isLocalDomain() || config.allowDefaultPassword) return;

    throw new Error(
        `Refusing to start on ${config.domain} with the default password. `
        + 'Set PASSWORD to something only you know, or set ALLOW_DEFAULT_PASSWORD=1 if this is deliberate.');
}
