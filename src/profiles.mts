/**
 * The profile registry.
 *
 * One profile is one person's Tally instance. It holds the XML port that copy
 * of Tally listens on, the password that unlocks the OAuth consent page, and a
 * bearer token for clients that cannot run an OAuth flow.
 *
 * Secrets are stored as hashes only. A token is shown once, when it is made,
 * and can never be read back from the file.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Ids appear in a URL, so they are kept to a small, unambiguous alphabet. */
export const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface Profile {
    id: string;
    /** Shown in the setup page, for example 'Ramesh, Acme Traders'. */
    label: string;
    /** Informational: the Windows account this profile belongs to. */
    windowsUser: string;
    tallyHost: string;
    tallyPort: number;
    /** Informational: where that copy of Tally keeps its company data. */
    dataPath: string;
    /** True hides the write tools from this profile. */
    blockWrite: boolean;
    /** scrypt hash of the consent page password. */
    passwordHash: string;
    /** SHA-256 of the bearer token. */
    tokenHash: string;
    createdAt: string;
}

/** A profile with every secret removed, which is all the setup page ever sees. */
export type PublicProfile = Omit<Profile, 'passwordHash' | 'tokenHash'>;

export interface CreateProfileInput {
    id: string;
    label?: string;
    windowsUser?: string;
    tallyHost?: string;
    tallyPort: number;
    dataPath?: string;
    blockWrite?: boolean;
    password: string;
}

interface RegistryFile {
    version: 1;
    profiles: Profile[];
}

/** Where the registry and the admin token live. */
export function defaultDataDir(): string {
    if (process.env.TALLY_MCP_DATA_DIR) return process.env.TALLY_MCP_DATA_DIR;
    if (process.platform === 'win32')
        return path.join(process.env.ProgramData || 'C:\\ProgramData', 'TallyMcpServer');
    return path.join(os.homedir(), '.tally-mcp-server');
}

const SCRYPT_KEYLEN = 32;

export function hashPassword(password: string): string {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPasswordHash(password: string, stored: string): boolean {
    const [scheme, salt, expected] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !expected) return false;

    const derived = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), SCRYPT_KEYLEN);
    const expectedBuffer = Buffer.from(expected, 'base64url');
    // timingSafeEqual throws on a length mismatch, so that case is answered first
    if (derived.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(derived, expectedBuffer);
}

/** Tokens carry 256 bits of entropy, so a plain digest is enough; they are not guessable. */
export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export const generateToken = (): string => crypto.randomBytes(32).toString('base64url');

export function safeEqualsHex(a: string, b: string): boolean {
    const left = Buffer.from(a ?? '', 'utf8');
    const right = Buffer.from(b ?? '', 'utf8');
    if (left.length !== right.length) {
        crypto.timingSafeEqual(left, left);
        return false;
    }
    return crypto.timingSafeEqual(left, right);
}

export const toPublicProfile = (profile: Profile): PublicProfile => {
    const { passwordHash, tokenHash, ...rest } = profile;
    return rest;
};

export class ProfileStore {
    readonly dir: string;
    readonly file: string;
    private profiles = new Map<string, Profile>();

    constructor(dir: string = defaultDataDir()) {
        this.dir = dir;
        this.file = path.join(dir, 'profiles.json');
        this.load();
    }

    /** True when no profile has been made yet, so the server runs in single user mode. */
    get isEmpty(): boolean {
        return this.profiles.size === 0;
    }

    load(): void {
        this.profiles.clear();
        let raw: string;
        try {
            raw = fs.readFileSync(this.file, 'utf8');
        } catch {
            return; // a missing registry is an empty registry, not an error
        }

        const parsed = JSON.parse(raw) as RegistryFile;
        for (const profile of parsed?.profiles ?? [])
            if (PROFILE_ID_PATTERN.test(profile.id)) this.profiles.set(profile.id, profile);
    }

    private save(): void {
        fs.mkdirSync(this.dir, { recursive: true });
        const payload: RegistryFile = { version: 1, profiles: [...this.profiles.values()] };

        // written to a sibling and renamed, so a crash mid-write cannot truncate the registry
        const temp = `${this.file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(payload, null, 2), { mode: 0o600 });
        fs.renameSync(temp, this.file);
    }

    list(): PublicProfile[] {
        return [...this.profiles.values()]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(toPublicProfile);
    }

    get(id: string): Profile | undefined {
        return this.profiles.get(id);
    }

    /** Returns the new profile and its bearer token. The token is not stored and cannot be read again. */
    create(input: CreateProfileInput): { profile: PublicProfile; token: string } {
        if (!PROFILE_ID_PATTERN.test(input.id))
            throw new Error('The id must be 1 to 32 characters of a to z, 0 to 9, hyphen or underscore, and must not start with a hyphen');

        if (this.profiles.has(input.id))
            throw new Error(`A profile named ${input.id} already exists`);

        if (!Number.isInteger(input.tallyPort) || input.tallyPort < 1 || input.tallyPort > 65535)
            throw new Error('The Tally port must be a whole number between 1 and 65535');

        if (typeof input.password !== 'string' || input.password.length < 8)
            throw new Error('The password must be at least 8 characters long');

        const token = generateToken();
        const profile: Profile = {
            id: input.id,
            label: input.label || input.id,
            windowsUser: input.windowsUser ?? '',
            tallyHost: input.tallyHost || '127.0.0.1',
            tallyPort: input.tallyPort,
            dataPath: input.dataPath ?? '',
            // writing to accounting data stays off until an administrator turns it on
            blockWrite: input.blockWrite ?? true,
            passwordHash: hashPassword(input.password),
            tokenHash: hashToken(token),
            createdAt: new Date().toISOString(),
        };

        this.profiles.set(profile.id, profile);
        this.save();
        return { profile: toPublicProfile(profile), token };
    }

    update(id: string, patch: Partial<Omit<CreateProfileInput, 'id'>>): PublicProfile {
        const profile = this.profiles.get(id);
        if (!profile) throw new Error(`No profile named ${id}`);

        if (patch.tallyPort !== undefined) {
            if (!Number.isInteger(patch.tallyPort) || patch.tallyPort < 1 || patch.tallyPort > 65535)
                throw new Error('The Tally port must be a whole number between 1 and 65535');
            profile.tallyPort = patch.tallyPort;
        }

        if (patch.password !== undefined) {
            if (patch.password.length < 8)
                throw new Error('The password must be at least 8 characters long');
            profile.passwordHash = hashPassword(patch.password);
        }

        if (patch.label !== undefined) profile.label = patch.label;
        if (patch.windowsUser !== undefined) profile.windowsUser = patch.windowsUser;
        if (patch.tallyHost !== undefined) profile.tallyHost = patch.tallyHost || '127.0.0.1';
        if (patch.dataPath !== undefined) profile.dataPath = patch.dataPath;
        if (patch.blockWrite !== undefined) profile.blockWrite = patch.blockWrite;

        this.save();
        return toPublicProfile(profile);
    }

    rotateToken(id: string): string {
        const profile = this.profiles.get(id);
        if (!profile) throw new Error(`No profile named ${id}`);

        const token = generateToken();
        profile.tokenHash = hashToken(token);
        this.save();
        return token;
    }

    remove(id: string): boolean {
        if (!this.profiles.delete(id)) return false;
        this.save();
        return true;
    }

    verifyToken(id: string, token: string): boolean {
        const profile = this.profiles.get(id);
        if (!profile || !token) return false;
        return safeEqualsHex(profile.tokenHash, hashToken(token));
    }

    verifyPassword(id: string, password: string): boolean {
        const profile = this.profiles.get(id);
        if (!profile || typeof password !== 'string') return false;
        return verifyPasswordHash(password, profile.passwordHash);
    }
}

/**
 * Reads the admin token, making one on first start.
 *
 * The setup page is reachable only from this machine, but a Windows Server has
 * several people on it at once, so loopback alone is not a boundary. The token
 * is what separates an administrator from any other signed in user.
 */
export function ensureAdminToken(dir: string = defaultDataDir()): string {
    const file = path.join(dir, 'admin-token.txt');
    try {
        const existing = fs.readFileSync(file, 'utf8').trim();
        if (existing) return existing;
    } catch {
        // falls through and makes one
    }

    const token = generateToken();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, token, { mode: 0o600 });
    return token;
}
