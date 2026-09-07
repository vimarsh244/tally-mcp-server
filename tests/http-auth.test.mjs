import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startHttp, authenticate, openSession, rawRequest, INITIALIZE } from './http-helpers.mjs';

const run = promisify(execFile);
let http;

before(async () => { http = await startHttp(); });
after(async () => { await http.close(); });

test('the happy path still works end to end', async () => {
    const session = await authenticate(http);
    assert.equal(session.authStatus, 200);
    assert.equal(session.tokenStatus, 200);
    assert.ok(session.tokens.access_token);
    assert.ok(session.tokens.refresh_token);
    assert.notEqual(session.tokens.refresh_token, session.tokens.access_token,
        'the refresh token used to be a copy of the access token');

    const { sessionId, status } = await openSession(http, session.tokens.access_token);
    assert.equal(status, 200);
    assert.ok(sessionId, 'no session id was issued');
});

test('every /mcp method requires a token', async () => {
    for (const [method, opts] of [
        ['POST', { body: INITIALIZE }],
        ['GET', {}],
        ['DELETE', {}],
    ]) {
        const res = await http.call(method, '/mcp', { ...opts, headers: { 'mcp-session-id': crypto.randomUUID() } });
        assert.equal(res.status, 401, `${method} /mcp was reachable without a token`);
        assert.match(res.headers.get('www-authenticate') ?? '', /Bearer resource_metadata=/,
            `${method} /mcp did not say how to authenticate`);
    }
});

test('an invalid or expired token is refused', async () => {
    const res = await http.call('POST', '/mcp', {
        body: INITIALIZE, headers: { Authorization: 'Bearer not-a-real-token' },
    });
    assert.equal(res.status, 401);
});

test('one client cannot drive another client\'s session', async () => {
    const alice = await authenticate(http);
    const bob = await authenticate(http);

    const { sessionId } = await openSession(http, alice.tokens.access_token);
    assert.ok(sessionId);

    // Bob holds a valid token, but the session is not his
    for (const method of ['POST', 'GET', 'DELETE']) {
        const res = await http.call(method, '/mcp', {
            ...(method === 'POST' ? { body: { jsonrpc: '2.0', id: 2, method: 'ping' } } : {}),
            headers: { Authorization: `Bearer ${bob.tokens.access_token}`, 'mcp-session-id': sessionId },
        });
        assert.notEqual(res.status, 200, `Bob reached Alice's session with ${method}`);
    }

    // and Alice still can
    const mine = await http.call('DELETE', '/mcp', {
        headers: { Authorization: `Bearer ${alice.tokens.access_token}`, 'mcp-session-id': sessionId },
    });
    assert.notEqual(mine.status, 401);
    assert.notEqual(mine.status, 400, 'the owner lost access to their own session');
});

test('/token verifies the client secret', async () => {
    const reg = await http.call('POST', '/register', {
        body: { client_name: 't', redirect_uris: ['https://example.com/cb'] },
    });
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    const auth = await http.call('POST', '/authorize', {
        form: {
            client_id: reg.json.client_id, redirect_uri: 'https://example.com/cb',
            code_challenge: challenge, code_challenge_method: 'S256', password: 'password',
        },
    });

    const body = {
        grant_type: 'authorization_code', code: auth.json.code,
        redirect_uri: 'https://example.com/cb', client_id: reg.json.client_id,
        code_verifier: verifier,
    };

    const noSecret = await http.call('POST', '/token', { form: body });
    assert.equal(noSecret.status, 401, 'a token was issued without a client secret');

    const wrongSecret = await http.call('POST', '/token', { form: { ...body, client_secret: 'wrong' } });
    assert.equal(wrongSecret.status, 401, 'a token was issued with the wrong client secret');
});

test('the refresh grant works, rotates, and is bound to its client', async () => {
    const alice = await authenticate(http);
    const bob = await authenticate(http);

    const refreshed = await http.call('POST', '/token', {
        form: {
            grant_type: 'refresh_token', refresh_token: alice.tokens.refresh_token,
            client_id: alice.client.client_id, client_secret: alice.client.client_secret,
        },
    });
    assert.equal(refreshed.status, 200, 'the refresh grant was refused');
    assert.ok(refreshed.json.access_token);
    assert.notEqual(refreshed.json.refresh_token, alice.tokens.refresh_token, 'the refresh token did not rotate');

    // the spent token is dead
    const replay = await http.call('POST', '/token', {
        form: {
            grant_type: 'refresh_token', refresh_token: alice.tokens.refresh_token,
            client_id: alice.client.client_id, client_secret: alice.client.client_secret,
        },
    });
    assert.equal(replay.status, 400, 'a spent refresh token was accepted again');

    // and Bob cannot spend a token issued to Alice
    const stolen = await http.call('POST', '/token', {
        form: {
            grant_type: 'refresh_token', refresh_token: refreshed.json.refresh_token,
            client_id: bob.client.client_id, client_secret: bob.client.client_secret,
        },
    });
    assert.equal(stolen.status, 400, 'a refresh token crossed clients');
});

test('the new access token from a refresh actually works', async () => {
    const alice = await authenticate(http);
    const refreshed = await http.call('POST', '/token', {
        form: {
            grant_type: 'refresh_token', refresh_token: alice.tokens.refresh_token,
            client_id: alice.client.client_id, client_secret: alice.client.client_secret,
        },
    });
    const { status } = await openSession(http, refreshed.json.access_token);
    assert.equal(status, 200);
});

test('an authorization code cannot be replayed', async () => {
    const alice = await authenticate(http);
    const replay = await http.call('POST', '/token', {
        form: {
            grant_type: 'authorization_code', code: alice.code,
            redirect_uri: alice.redirectUri, client_id: alice.client.client_id,
            client_secret: alice.client.client_secret, code_verifier: alice.verifier,
        },
    });
    assert.equal(replay.status, 400, 'an authorization code was spent twice');
});

test('PKCE is enforced', async () => {
    const reg = await http.call('POST', '/register', { body: { client_name: 't', redirect_uris: ['https://example.com/cb'] } });
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    const auth = await http.call('POST', '/authorize', {
        form: {
            client_id: reg.json.client_id, redirect_uri: 'https://example.com/cb',
            code_challenge: challenge, code_challenge_method: 'S256', password: 'password',
        },
    });

    const wrong = await http.call('POST', '/token', {
        form: {
            grant_type: 'authorization_code', code: auth.json.code,
            redirect_uri: 'https://example.com/cb', client_id: reg.json.client_id,
            client_secret: reg.json.client_secret, code_verifier: 'the-wrong-verifier',
        },
    });
    assert.equal(wrong.status, 400, 'a wrong PKCE verifier was accepted');
});

test('/authorize validates the client and the redirect uri', async () => {
    const reg = await http.call('POST', '/register', { body: { client_name: 't', redirect_uris: ['https://example.com/cb'] } });

    const unknownClient = await http.call('POST', '/authorize', {
        form: { client_id: 'nope', redirect_uri: 'https://example.com/cb', code_challenge: 'x', code_challenge_method: 'S256', password: 'password' },
    });
    assert.equal(unknownClient.status, 400, 'an unregistered client_id was accepted');

    const badRedirect = await http.call('POST', '/authorize', {
        form: { client_id: reg.json.client_id, redirect_uri: 'https://evil.example/cb', code_challenge: 'x', code_challenge_method: 'S256', password: 'password' },
    });
    assert.equal(badRedirect.status, 400, 'an unregistered redirect_uri was accepted');
});

test('/register rejects a redirect uri that is not an absolute http(s) URL', async () => {
    for (const uri of ['javascript:alert(1)', '/relative', 'https://example.com/cb#f']) {
        const res = await http.call('POST', '/register', { body: { client_name: 't', redirect_uris: [uri] } });
        assert.equal(res.status, 400, `accepted ${uri}`);
    }
    const empty = await http.call('POST', '/register', { body: { client_name: 't', redirect_uris: [] } });
    assert.equal(empty.status, 400);
});

test('repeated wrong passwords are rate limited', async () => {
    const local = await startHttp();
    try {
        const reg = await local.call('POST', '/register', { body: { client_name: 't', redirect_uris: ['https://example.com/cb'] } });
        const form = {
            client_id: reg.json.client_id, redirect_uri: 'https://example.com/cb',
            code_challenge: 'x', code_challenge_method: 'S256', password: 'wrong',
        };

        const codes = [];
        for (let i = 0; i < 14; i++) codes.push((await local.call('POST', '/authorize', { form })).status);

        assert.ok(codes.includes(401), 'a wrong password should be refused');
        assert.ok(codes.includes(429), `the attempt limit never fired: ${codes.join(',')}`);
    } finally {
        await local.close();
    }
});

test('DNS rebinding protection rejects a foreign Host header', async () => {
    const alice = await authenticate(http);

    // a rebinding attack arrives with the attacker's name in Host
    const res = await rawRequest(http.port, {
        body: INITIALIZE,
        headers: {
            Authorization: `Bearer ${alice.tokens.access_token}`,
            Accept: 'application/json, text/event-stream',
            Host: 'evil.example',
        },
    });
    assert.equal(res.status, 403, 'a foreign Host header was accepted');

    // the legitimate host still works
    const good = await openSession(http, alice.tokens.access_token);
    assert.equal(good.status, 200);
});

test('the discovery document advertises the refresh grant', async () => {
    const res = await http.call('GET', '/.well-known/oauth-authorization-server');
    assert.equal(res.status, 200);
    assert.ok(res.json.grant_types_supported.includes('refresh_token'));
    assert.deepEqual(res.json.code_challenge_methods_supported, ['S256']);
});

test('the server refuses to start on a public domain with the default password', async () => {
    const script = `
        const { assertPasswordIsSafe } = await import('./dist/config.mjs');
        try { assertPasswordIsSafe(); console.log('STARTED'); }
        catch (e) { console.log('REFUSED: ' + e.message); }
    `;
    const at = (env) => run(process.execPath, ['--input-type=module', '-e', script], {
        cwd: new URL('..', import.meta.url).pathname,
        env: { ...process.env, ...env },
    }).then((r) => r.stdout.trim());

    assert.match(await at({ MCP_DOMAIN: 'https://tally.example.com', PASSWORD: 'password' }), /^REFUSED/);
    assert.match(await at({ MCP_DOMAIN: 'https://tally.example.com', PASSWORD: 'a-real-secret' }), /^STARTED$/);
    assert.match(await at({ MCP_DOMAIN: 'http://localhost:3000', PASSWORD: 'password' }), /^STARTED$/);
    assert.match(await at({ MCP_DOMAIN: 'https://tally.example.com', PASSWORD: 'password', ALLOW_DEFAULT_PASSWORD: '1' }), /^STARTED$/);
});
