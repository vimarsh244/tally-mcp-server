import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AuthStore, isValidRedirectUri, safeEquals, verifyPKCE } from '../dist/http/store.mjs';

test('safeEquals compares correctly regardless of length', () => {
    assert.equal(safeEquals('abc', 'abc'), true);
    assert.equal(safeEquals('abc', 'abd'), false);
    assert.equal(safeEquals('abc', 'abcd'), false);
    assert.equal(safeEquals('', ''), true);
    assert.equal(safeEquals('a', ''), false);
});

test('verifyPKCE accepts only a correct S256 challenge', () => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    assert.equal(verifyPKCE(verifier, challenge, 'S256'), true);
    assert.equal(verifyPKCE('wrong', challenge, 'S256'), false);
    assert.equal(verifyPKCE(verifier, challenge, 'plain'), false, 'plain must not be accepted');
    assert.equal(verifyPKCE('', '', 'S256'), false);
});

test('isValidRedirectUri rejects anything that is not an absolute http(s) URL', () => {
    for (const good of ['https://example.com/cb', 'http://localhost:1234/cb'])
        assert.equal(isValidRedirectUri(good), true, good);

    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'example.com',
        'https://example.com/cb#frag', '', null, undefined, 42])
        assert.equal(isValidRedirectUri(bad), false, String(bad));
});

test('an authorization code can only be spent once', () => {
    const store = new AuthStore();
    const code = store.createAuthorizationCode({
        client_id: 'c', redirect_uri: 'https://example.com/cb',
        code_challenge: 'x', code_challenge_method: 'S256',
    });

    assert.ok(store.consumeAuthorizationCode(code));
    assert.equal(store.consumeAuthorizationCode(code), undefined, 'a code was replayed');
});

test('a refresh token can only be spent once', () => {
    const store = new AuthStore();
    const { refreshToken } = store.issueTokens('c', '');

    assert.ok(store.consumeRefreshToken(refreshToken));
    assert.equal(store.consumeRefreshToken(refreshToken), undefined, 'a refresh token was replayed');
});

test('client secrets are verified, and an absent secret never passes', () => {
    const store = new AuthStore();
    const client = store.registerClient('', 'n', ['https://example.com/cb']);

    assert.equal(store.verifyClientSecret(client.client_id, '', client.client_secret), true);
    assert.equal(store.verifyClientSecret(client.client_id, '', 'wrong'), false);
    assert.equal(store.verifyClientSecret(client.client_id, '', undefined), false);
    assert.equal(store.verifyClientSecret('unknown', '', 'whatever'), false);
});

test('the client table is bounded', () => {
    const store = new AuthStore();
    for (let i = 0; i < 150; i++) store.registerClient('', 'n', ['https://example.com/cb']);
    assert.ok(store.size().clients <= 100, `client table grew to ${store.size().clients}`);
});

test('password attempts are limited and reset on success', () => {
    const store = new AuthStore();
    let allowed = 0;
    for (let i = 0; i < 20; i++) if (store.allowPasswordAttempt('1.2.3.4')) allowed++;

    assert.equal(allowed, 10, 'the attempt limit was not applied');
    assert.equal(store.allowPasswordAttempt('5.6.7.8'), true, 'a different address must not be blocked');

    store.clearPasswordAttempts('1.2.3.4');
    assert.equal(store.allowPasswordAttempt('1.2.3.4'), true);
});

test('sweep drops what has expired', () => {
    const store = new AuthStore();
    store.createAuthorizationCode({ client_id: 'c', redirect_uri: 'r', code_challenge: 'x', code_challenge_method: 'S256' });
    store.issueTokens('c', '');
    assert.ok(store.size().codes > 0 && store.size().accessTokens > 0);

    store.sweep(Date.now() + 40 * 24 * 60 * 60 * 1000); // well past every lifetime
    assert.deepEqual(
        { codes: store.size().codes, accessTokens: store.size().accessTokens, refreshTokens: store.size().refreshTokens },
        { codes: 0, accessTokens: 0, refreshTokens: 0 });
});
