/**
 * In-memory OAuth state: registered clients, authorization codes and tokens.
 *
 * Everything is per process and is lost on restart, which is what the previous
 * implementation did too. The differences are that entries now expire, the
 * client table is bounded, refresh tokens exist as their own type, and secrets
 * are compared in constant time.
 */
import crypto from 'node:crypto';
import { config } from '../config.mjs';
export const generateSecureToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
/** Compares two secrets without leaking their contents through timing. */
export function safeEquals(a, b) {
    const left = Buffer.from(a ?? '', 'utf8');
    const right = Buffer.from(b ?? '', 'utf8');
    // timingSafeEqual throws on a length mismatch, so the lengths are folded into the result
    if (left.length !== right.length) {
        crypto.timingSafeEqual(left, left);
        return false;
    }
    return crypto.timingSafeEqual(left, right);
}
/** Verifies an RFC 7636 S256 challenge. Plain challenges are not accepted. */
export function verifyPKCE(verifier, challenge, method) {
    if (method !== 'S256')
        return false;
    if (!verifier || !challenge)
        return false;
    return safeEquals(crypto.createHash('sha256').update(verifier).digest('base64url'), challenge);
}
/** A redirect_uri must be an absolute http or https URL without a fragment. */
export function isValidRedirectUri(value) {
    if (typeof value !== 'string' || value.length === 0)
        return false;
    try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.hash === '';
    }
    catch {
        return false;
    }
}
export class AuthStore {
    clients = new Map();
    codes = new Map();
    accessTokens = new Map();
    refreshTokens = new Map();
    attempts = new Map();
    registerClient(realm, clientName, redirectUris) {
        // bounded so repeated registration cannot exhaust memory; the oldest goes first
        while (this.clients.size >= config.maxRegisteredClients) {
            const oldest = [...this.clients.entries()].sort((a, b) => a[1].created_at - b[1].created_at)[0];
            if (!oldest)
                break;
            this.clients.delete(oldest[0]);
        }
        const client = {
            client_id: generateSecureToken(16),
            realm,
            client_name: clientName,
            client_secret: generateSecureToken(32),
            redirect_uris: redirectUris,
            created_at: Date.now(),
        };
        this.clients.set(client.client_id, client);
        return client;
    }
    /** Returns the client only when it belongs to the realm that is asking for it. */
    getClient(clientId, realm) {
        const client = this.clients.get(clientId);
        return client && client.realm === realm ? client : undefined;
    }
    /** Confirms a client secret, in constant time, when the client presented one. */
    verifyClientSecret(clientId, realm, secret) {
        const client = this.getClient(clientId, realm);
        if (!client)
            return false;
        if (secret === undefined)
            return false;
        return safeEquals(client.client_secret, secret);
    }
    createAuthorizationCode(input) {
        const code = generateSecureToken(32);
        this.codes.set(code, { ...input, expires_at: Date.now() + 600000 }); // 10 minutes
        return code;
    }
    /** Returns the code and removes it, so a code can never be replayed. */
    consumeAuthorizationCode(code) {
        const entry = this.codes.get(code);
        if (!entry)
            return undefined;
        this.codes.delete(code);
        return entry.expires_at < Date.now() ? undefined : entry;
    }
    issueTokens(clientId, realm) {
        const accessToken = generateSecureToken(32);
        const refreshToken = generateSecureToken(32);
        this.accessTokens.set(accessToken, { client_id: clientId, realm, expires_at: Date.now() + config.accessTokenTtlMs });
        this.refreshTokens.set(refreshToken, { client_id: clientId, realm, expires_at: Date.now() + config.refreshTokenTtlMs });
        return { accessToken, refreshToken, expiresInSeconds: Math.floor(config.accessTokenTtlMs / 1000) };
    }
    verifyAccessToken(token) {
        const entry = this.accessTokens.get(token);
        if (!entry)
            return undefined;
        if (entry.expires_at < Date.now()) {
            this.accessTokens.delete(token);
            return undefined;
        }
        return entry;
    }
    /** Refresh tokens rotate: the presented token is spent whether or not it was valid. */
    consumeRefreshToken(token) {
        const entry = this.refreshTokens.get(token);
        if (!entry)
            return undefined;
        this.refreshTokens.delete(token);
        return entry.expires_at < Date.now() ? undefined : entry;
    }
    /**
     * Counts a password attempt. Returns false once the caller has spent its
     * allowance for the current window.
     */
    allowPasswordAttempt(key) {
        const now = Date.now();
        const entry = this.attempts.get(key);
        if (!entry || entry.resetAt < now) {
            this.attempts.set(key, { count: 1, resetAt: now + config.authAttemptWindowMs });
            return true;
        }
        entry.count += 1;
        return entry.count <= config.authAttemptLimit;
    }
    /** Forgets the attempt counter after a correct password. */
    clearPasswordAttempts(key) {
        this.attempts.delete(key);
    }
    /** Drops everything that has expired. Called on a timer by the server. */
    sweep(now = Date.now()) {
        for (const [key, value] of this.codes)
            if (value.expires_at < now)
                this.codes.delete(key);
        for (const [key, value] of this.accessTokens)
            if (value.expires_at < now)
                this.accessTokens.delete(key);
        for (const [key, value] of this.refreshTokens)
            if (value.expires_at < now)
                this.refreshTokens.delete(key);
        for (const [key, value] of this.attempts)
            if (value.resetAt < now)
                this.attempts.delete(key);
    }
    /** Test and diagnostic view of how much is being held. */
    size() {
        return {
            clients: this.clients.size,
            codes: this.codes.size,
            accessTokens: this.accessTokens.size,
            refreshTokens: this.refreshTokens.size,
        };
    }
}
//# sourceMappingURL=store.mjs.map