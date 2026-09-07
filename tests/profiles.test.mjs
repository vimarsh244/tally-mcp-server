/**
 * Multi user mode: one profile per Tally instance, each with its own address,
 * password and token, and no way to cross from one to another.
 *
 * MULTI_USER is set before the modules load, because config reads the
 * environment once at import time.
 */
process.env.MULTI_USER = '1';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { ProfileStore, hashPassword, verifyPasswordHash } = await import('../dist/profiles.mjs');
const { createApp } = await import('../dist/http/app.mjs');

const INITIALIZE = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
};

const ADMIN_TOKEN = 'admin-token-for-tests';

/** A stand-in Tally on an ephemeral port that names itself in every reply. */
async function startNamedTally(companyName) {
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.setEncoding('utf16le');
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            requests.push(body);
            const xml = `<DATA><ROW><NAME>${companyName}</NAME><ISACTIVECOMPANY>Yes</ISACTIVECOMPANY></ROW></DATA>`;
            res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-16' });
            res.end(Buffer.from(xml, 'utf16le'));
        });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        port: server.address().port,
        requests,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

let dataDir;
let profiles;
let server;
let base;
let close;
let tokens = {};

before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-mcp-test-'));
    profiles = new ProfileStore(dataDir);

    tokens.alice = profiles.create({ id: 'alice', tallyPort: 9000, password: 'alice-password' }).token;
    tokens.bob = profiles.create({ id: 'bob', tallyPort: 9001, password: 'bob-password' }).token;

    const publicDir = new URL('..', import.meta.url).pathname;
    const allowedHosts = [];
    const app = createApp(publicDir, { allowedHosts, profiles, adminToken: ADMIN_TOKEN });
    close = app.close;

    server = app.app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    allowedHosts.push(`127.0.0.1:${port}`, `localhost:${port}`);
    base = `http://127.0.0.1:${port}`;
});

after(async () => {
    close?.();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(method, pathname, { body, headers = {}, form } = {}) {
    const init = { method, headers: { ...headers } };
    if (form) {
        init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        init.body = new URLSearchParams(form).toString();
    } else if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    const res = await fetch(base + pathname, init);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, headers: res.headers, text, json };
}

/** Runs the whole OAuth flow against one profile's routes. */
async function authenticateAs(profileId, password) {
    const prefix = `/u/${profileId}`;
    const redirectUri = 'https://example.com/cb';

    const reg = await call('POST', `${prefix}/register`, {
        body: { client_name: 'test', redirect_uris: [redirectUri] },
    });

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    const auth = await call('POST', `${prefix}/authorize`, {
        form: {
            client_id: reg.json.client_id,
            redirect_uri: redirectUri,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            password,
        },
    });

    const token = await call('POST', `${prefix}/token`, {
        form: {
            grant_type: 'authorization_code',
            code: auth.json?.code,
            redirect_uri: redirectUri,
            client_id: reg.json.client_id,
            client_secret: reg.json.client_secret,
            code_verifier: verifier,
        },
    });

    return { client: reg.json, verifier, challenge, redirectUri, auth, token: token.json };
}

test('a profile stores no secret in the clear', () => {
    const raw = fs.readFileSync(path.join(dataDir, 'profiles.json'), 'utf8');
    assert.ok(!raw.includes('alice-password'), 'the password was written to disk');
    assert.ok(!raw.includes(tokens.alice), 'the bearer token was written to disk');
});

test('the registry rejects a bad id, a duplicate and a short password', () => {
    assert.throws(() => profiles.create({ id: 'Not Valid', tallyPort: 9000, password: 'longenough' }), /id must be/);
    assert.throws(() => profiles.create({ id: 'alice', tallyPort: 9000, password: 'longenough' }), /already exists/);
    assert.throws(() => profiles.create({ id: 'carol', tallyPort: 9000, password: 'short' }), /at least 8/);
    assert.throws(() => profiles.create({ id: 'carol', tallyPort: 70000, password: 'longenough' }), /between 1 and 65535/);
});

test('a password hash verifies only its own password', () => {
    const stored = hashPassword('correct horse');
    assert.equal(verifyPasswordHash('correct horse', stored), true);
    assert.equal(verifyPasswordHash('correct hors', stored), false);
    assert.equal(verifyPasswordHash('correct horse', 'not-a-hash'), false);
});

test('the registry survives a reload', () => {
    const reloaded = new ProfileStore(dataDir);
    assert.deepEqual(reloaded.list().map((p) => p.id), ['alice', 'bob']);
    assert.equal(reloaded.verifyToken('alice', tokens.alice), true);
    assert.equal(reloaded.verifyPassword('alice', 'alice-password'), true);
});

test('a new profile is read only until an administrator says otherwise', () => {
    const store = new ProfileStore(fs.mkdtempSync(path.join(os.tmpdir(), 'tally-mcp-test-')));
    const { profile } = store.create({ id: 'dave', tallyPort: 9002, password: 'longenough' });
    assert.equal(profile.blockWrite, true);
    fs.rmSync(store.dir, { recursive: true, force: true });
});

test('multi user mode switches the root realm off', async () => {
    for (const [method, options] of [['POST', { body: INITIALIZE }], ['GET', {}], ['DELETE', {}]]) {
        const res = await call(method, '/mcp', options);
        assert.equal(res.status, 404, `${method} /mcp was still served at the root`);
    }

    const authorize = await call('POST', '/authorize', { form: { client_id: 'x', password: 'password' } });
    assert.equal(authorize.status, 404, 'the root consent page was still reachable');
});

test('an unknown profile is not found', async () => {
    const res = await call('POST', '/u/nobody/mcp', { body: INITIALIZE });
    assert.equal(res.status, 404);
});

test('discovery names the profile as its own issuer and resource', async () => {
    const resource = await call('GET', '/.well-known/oauth-protected-resource/u/alice/mcp');
    assert.equal(resource.status, 200);
    assert.match(resource.json.resource, /\/u\/alice\/mcp$/);
    assert.match(resource.json.authorization_servers[0], /\/u\/alice$/);

    const server = await call('GET', '/.well-known/oauth-authorization-server/u/alice');
    assert.equal(server.status, 200);
    assert.match(server.json.authorization_endpoint, /\/u\/alice\/authorize$/);
    assert.match(server.json.token_endpoint, /\/u\/alice\/token$/);

    const missing = await call('GET', '/.well-known/oauth-protected-resource/u/nobody/mcp');
    assert.equal(missing.status, 404);
});

test('the OAuth flow works against one profile', async () => {
    const alice = await authenticateAs('alice', 'alice-password');
    assert.equal(alice.auth.status, 200);
    assert.ok(alice.token.access_token);
    assert.ok(alice.token.refresh_token);
});

test('a profile refuses another profile\'s password', async () => {
    const wrong = await authenticateAs('bob', 'alice-password');
    assert.equal(wrong.auth.status, 401);
});

test('an access token from one profile is refused by another', async () => {
    const alice = await authenticateAs('alice', 'alice-password');
    const accessToken = alice.token.access_token;

    const mine = await call('POST', '/u/alice/mcp', {
        body: INITIALIZE,
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json, text/event-stream' },
    });
    assert.equal(mine.status, 200, 'the token did not work on its own profile');
    assert.ok(mine.headers.get('mcp-session-id'));

    for (const method of ['POST', 'GET', 'DELETE']) {
        const res = await call(method, '/u/bob/mcp', {
            ...(method === 'POST' ? { body: INITIALIZE } : {}),
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        assert.equal(res.status, 401, `${method} reached bob with alice's token`);
    }
});

test('a client registered under one profile cannot be used under another', async () => {
    const alice = await authenticateAs('alice', 'alice-password');

    const res = await call('POST', '/u/bob/authorize', {
        form: {
            client_id: alice.client.client_id,
            redirect_uri: alice.redirectUri,
            code_challenge: alice.challenge,
            code_challenge_method: 'S256',
            password: 'bob-password',
        },
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'invalid_client');
});

test('an alice session id cannot be driven from bob\'s address', async () => {
    const alice = await authenticateAs('alice', 'alice-password');
    const opened = await call('POST', '/u/alice/mcp', {
        body: INITIALIZE,
        headers: { Authorization: `Bearer ${alice.token.access_token}`, Accept: 'application/json, text/event-stream' },
    });
    const sessionId = opened.headers.get('mcp-session-id');
    assert.ok(sessionId);

    const bob = await authenticateAs('bob', 'bob-password');
    const res = await call('POST', '/u/bob/mcp', {
        body: { jsonrpc: '2.0', id: 2, method: 'ping' },
        headers: { Authorization: `Bearer ${bob.token.access_token}`, 'mcp-session-id': sessionId },
    });

    assert.equal(res.status, 400, 'bob reached a session that belongs to alice');
});

test('the static bearer token opens a session on its own profile only', async () => {
    const mine = await call('POST', '/u/alice/mcp', {
        body: INITIALIZE,
        headers: { Authorization: `Bearer ${tokens.alice}`, Accept: 'application/json, text/event-stream' },
    });
    assert.equal(mine.status, 200);

    const theirs = await call('POST', '/u/bob/mcp', {
        body: INITIALIZE,
        headers: { Authorization: `Bearer ${tokens.alice}`, Accept: 'application/json, text/event-stream' },
    });
    assert.equal(theirs.status, 401);

    const rubbish = await call('POST', '/u/alice/mcp', {
        body: INITIALIZE,
        headers: { Authorization: 'Bearer not-a-real-token', Accept: 'application/json, text/event-stream' },
    });
    assert.equal(rubbish.status, 401);
});

test('a rotated token replaces the old one', () => {
    const store = new ProfileStore(dataDir);
    const fresh = store.rotateToken('bob');
    assert.equal(store.verifyToken('bob', fresh), true);
    assert.equal(store.verifyToken('bob', tokens.bob), false);
    tokens.bob = fresh;
});

test('the setup API needs the admin token', async () => {
    const none = await call('GET', '/admin/api/state');
    assert.equal(none.status, 401);

    const wrong = await call('GET', '/admin/api/state', { headers: { 'X-Admin-Token': 'nope' } });
    assert.equal(wrong.status, 401);

    const right = await call('GET', '/admin/api/state', { headers: { 'X-Admin-Token': ADMIN_TOKEN } });
    assert.equal(right.status, 200);
    assert.equal(right.json.multiUser, true);
    assert.deepEqual(right.json.profiles.map((p) => p.id).sort(), ['alice', 'bob']);
});

test('the setup API never returns a stored secret', async () => {
    const res = await call('GET', '/admin/api/state', { headers: { 'X-Admin-Token': ADMIN_TOKEN } });
    const body = JSON.stringify(res.json);
    assert.ok(!body.includes('passwordHash'), 'a password hash was sent to the page');
    assert.ok(!body.includes('tokenHash'), 'a token hash was sent to the page');
    assert.match(res.json.profiles[0].url, /\/u\/alice\/mcp$/);
});

test('the setup API creates a profile and shows its token once', async () => {
    const created = await call('POST', '/admin/api/profiles', {
        headers: { 'X-Admin-Token': ADMIN_TOKEN },
        body: { id: 'carol', tallyPort: 9002, password: 'carol-password', label: 'Carol' },
    });

    assert.equal(created.status, 200);
    assert.ok(created.json.token);
    assert.match(created.json.profile.url, /\/u\/carol\/mcp$/);

    const carol = await authenticateAs('carol', 'carol-password');
    assert.ok(carol.token.access_token);

    const removed = await call('DELETE', '/admin/api/profiles/carol', {
        headers: { 'X-Admin-Token': ADMIN_TOKEN },
    });
    assert.equal(removed.status, 200);

    const gone = await call('POST', '/u/carol/mcp', { body: INITIALIZE });
    assert.equal(gone.status, 404);
});

test('a scan refuses a range that is backwards or too wide', async () => {
    const headers = { 'X-Admin-Token': ADMIN_TOKEN };

    const backwards = await call('POST', '/admin/api/scan', { headers, body: { fromPort: 9010, toPort: 9000 } });
    assert.equal(backwards.status, 400);

    const wide = await call('POST', '/admin/api/scan', { headers, body: { fromPort: 9000, toPort: 9200 } });
    assert.equal(wide.status, 400);
});

test('a tool call reaches the profile\'s own Tally, not another profile\'s', async () => {
    // two stand-in Tally instances, each naming itself in its reply
    const instances = await Promise.all(['Alice Traders', 'Bob Exports'].map(startNamedTally));
    const [aliceTally, bobTally] = instances;

    // the running server holds this registry, so the edit must go through it
    profiles.update('alice', { tallyPort: aliceTally.port });
    profiles.update('bob', { tallyPort: bobTally.port });

    try {
        for (const [id, password, tally, expected] of [
            ['alice', 'alice-password', aliceTally, 'Alice Traders'],
            ['bob', 'bob-password', bobTally, 'Bob Exports'],
        ]) {
            const session = await authenticateAs(id, password);
            const headers = {
                Authorization: `Bearer ${session.token.access_token}`,
                Accept: 'application/json, text/event-stream',
            };

            const opened = await call('POST', `/u/${id}/mcp`, { body: INITIALIZE, headers });
            const sessionId = opened.headers.get('mcp-session-id');
            assert.ok(sessionId, `no session opened for ${id}`);

            const called = await call('POST', `/u/${id}/mcp`, {
                headers: { ...headers, 'mcp-session-id': sessionId },
                body: {
                    jsonrpc: '2.0',
                    id: 3,
                    method: 'tools/call',
                    params: { name: 'list-master', arguments: { collection: 'company' } },
                },
            });

            assert.equal(called.status, 200, `the tool call failed for ${id}`);
            assert.match(called.text, new RegExp(expected), `${id} did not get its own company back`);
            assert.equal(tally.requests.length, 1, `${id} sent ${tally.requests.length} requests to its own Tally`);
        }

        // neither instance was touched by the other profile's session
        assert.equal(aliceTally.requests.length, 1);
        assert.equal(bobTally.requests.length, 1);
    } finally {
        await Promise.all(instances.map((instance) => instance.close()));
        profiles.update('alice', { tallyPort: 9000 });
        profiles.update('bob', { tallyPort: 9001 });
    }
});

test('a read only profile does not offer the write tools', async () => {
    profiles.update('alice', { blockWrite: true });
    profiles.update('bob', { blockWrite: false });

    const names = async (id, password) => {
        const session = await authenticateAs(id, password);
        const headers = {
            Authorization: `Bearer ${session.token.access_token}`,
            Accept: 'application/json, text/event-stream',
        };
        const opened = await call('POST', `/u/${id}/mcp`, { body: INITIALIZE, headers });
        const listed = await call('POST', `/u/${id}/mcp`, {
            headers: { ...headers, 'mcp-session-id': opened.headers.get('mcp-session-id') },
            body: { jsonrpc: '2.0', id: 4, method: 'tools/list' },
        });
        return listed.text;
    };

    assert.ok(!(await names('alice', 'alice-password')).includes('delete-master'),
        'a read only profile was offered the write tools');
    assert.ok((await names('bob', 'bob-password')).includes('delete-master'),
        'a read and write profile was not offered the write tools');
});
