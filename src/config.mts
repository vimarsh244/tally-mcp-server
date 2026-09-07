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
    domain: process.env.MCP_DOMAIN || 'http://localhost:3000',
    password: process.env.PASSWORD || DEFAULT_PASSWORD,

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
    if (config.password !== DEFAULT_PASSWORD) return;
    if (isLocalDomain() || config.allowDefaultPassword) return;

    throw new Error(
        `Refusing to start on ${config.domain} with the default password. `
        + 'Set PASSWORD to something only you know, or set ALLOW_DEFAULT_PASSWORD=1 if this is deliberate.');
}
