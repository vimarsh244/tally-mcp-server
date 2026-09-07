/**
 * OAuth 2.1 endpoints: discovery, dynamic registration, authorization, token.
 *
 * Every endpoint is realm aware. The same handlers serve the root realm at
 * /authorize and a profile realm at /u/<id>/authorize, because the router they
 * are registered on is mounted at both places. A client, a code and a token all
 * carry the realm they were made under, and every step checks it, so nothing
 * issued under one profile is usable under another.
 */

import path from 'node:path';
import express from 'express';
import { AuthStore, isValidRedirectUri, safeEquals, verifyPKCE } from './store.mjs';
import type { Realm, RealmResolver } from './realm.mjs';

const oauthError = (res: express.Response, status: number, error: string, description: string) =>
    res.status(status).json({ error, error_description: description });

const unknownRealm = (res: express.Response) =>
    oauthError(res, 404, 'invalid_request', 'No such profile on this server');

/**
 * The address a request came from, kept per realm so a wrong password for one
 * profile cannot lock another profile out.
 */
const attemptKey = (req: express.Request, realm: Realm): string =>
    `${realm.id}|${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;

/** The metadata a client reads to learn how to authenticate against a realm. */
function protectedResourceDocument(realm: Realm) {
    return {
        resource: realm.resource,
        authorization_servers: [realm.issuer],
        bearer_methods_supported: ['header'],
        scopes_supported: ['email'],
    };
}

function authorizationServerDocument(realm: Realm) {
    return {
        issuer: realm.issuer,
        authorization_endpoint: `${realm.issuer}/authorize`,
        token_endpoint: `${realm.issuer}/token`,
        registration_endpoint: `${realm.issuer}/register`,
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        code_challenge_methods_supported: ['S256'],
    };
}

/**
 * Discovery documents live under /.well-known with the resource path appended,
 * so /u/<id>/mcp is described at /.well-known/oauth-protected-resource/u/<id>/mcp.
 * That shape cannot come from a mounted router, so both forms are registered here.
 */
export function registerWellKnownRoutes(app: express.Express, resolveRealm: RealmResolver): void {
    const serve = (build: (realm: Realm) => object) => (req: express.Request, res: express.Response) => {
        const realm = resolveRealm(req);
        if (!realm) return unknownRealm(res);
        res.status(200).json(build(realm));
    };

    const resource = serve(protectedResourceDocument);
    const authServer = serve(authorizationServerDocument);

    for (const suffix of ['', '/mcp']) {
        app.get(`/.well-known/oauth-protected-resource${suffix}`, resource);
        app.get(`/.well-known/oauth-protected-resource/u/:profileId${suffix}`, resource);
        app.get(`/.well-known/oauth-authorization-server${suffix}`, authServer);
        app.get(`/.well-known/oauth-authorization-server/u/:profileId${suffix}`, authServer);
    }
}

export function registerOAuthRoutes(router: express.Router, store: AuthStore, publicDir: string, resolveRealm: RealmResolver): void {
    router.post('/register', (req, res) => {
        const realm = resolveRealm(req);
        if (!realm) return unknownRealm(res);

        const redirectUris = req.body?.['redirect_uris'];

        if (!Array.isArray(redirectUris) || redirectUris.length === 0)
            return oauthError(res, 400, 'invalid_client_metadata', 'redirect_uris must be a non-empty array');

        // an unchecked redirect_uri turns the authorize endpoint into an open redirect
        if (!redirectUris.every(isValidRedirectUri))
            return oauthError(res, 400, 'invalid_redirect_uri', 'every redirect_uri must be an absolute http or https URL without a fragment');

        const clientName = typeof req.body?.['client_name'] === 'string' ? req.body['client_name'] : 'Unnamed Client';
        const client = store.registerClient(realm.id, clientName, redirectUris);

        // kept at 200 rather than the 201 the RFC prefers, because the previous
        // implementation answered 200 and existing clients are known to accept it
        res.status(200).json({
            client_id: client.client_id,
            client_name: client.client_name,
            client_secret: client.client_secret,
            redirect_uris: client.redirect_uris,
        });
    });

    // The consent page. Parameters are validated before the page is served, so a
    // bad client never reaches the password prompt.
    router.get('/authorize', (req, res) => {
        const realm = resolveRealm(req);
        if (!realm) return unknownRealm(res);

        const clientId = req.query.client_id as string;
        const redirectUri = req.query.redirect_uri as string;
        const codeChallenge = req.query.code_challenge as string;
        const codeChallengeMethod = req.query.code_challenge_method as string;
        const responseType = req.query.response_type as string;

        if (!clientId || !redirectUri || !codeChallenge || !responseType)
            return oauthError(res, 400, 'invalid_request', 'Missing required parameters');

        if (responseType !== 'code')
            return oauthError(res, 400, 'unsupported_response_type', 'Only "code" response type is supported');

        if (codeChallengeMethod !== 'S256')
            return oauthError(res, 400, 'invalid_request', 'Only S256 code challenge method is supported');

        const client = store.getClient(clientId, realm.id);
        if (!client)
            return oauthError(res, 400, 'invalid_client', 'Unknown client_id');

        if (!client.redirect_uris.includes(redirectUri))
            return oauthError(res, 400, 'invalid_request', 'Invalid redirect_uri');

        res.status(200).header('Content-Type', 'text/html').sendFile(path.join(publicDir, 'authorize.html'));
    });

    // The password submission behind the consent page.
    router.post('/authorize', (req, res) => {
        const realm = resolveRealm(req);
        if (!realm) return unknownRealm(res);

        const clientId = req.body?.['client_id'];
        const redirectUri = req.body?.['redirect_uri'];
        const codeChallenge = req.body?.['code_challenge'];
        const codeChallengeMethod = req.body?.['code_challenge_method'];
        const password = req.body?.['password'];

        if (!clientId || typeof password !== 'string')
            return oauthError(res, 400, 'invalid_request', 'Missing client_id or password');

        // the client and its redirect_uri are checked here too, not only on the GET
        const client = store.getClient(clientId, realm.id);
        if (!client)
            return oauthError(res, 400, 'invalid_client', 'Unknown client_id');

        if (!client.redirect_uris.includes(redirectUri))
            return oauthError(res, 400, 'invalid_request', 'Invalid redirect_uri');

        if (codeChallengeMethod !== 'S256' || !codeChallenge)
            return oauthError(res, 400, 'invalid_request', 'Only S256 code challenge method is supported');

        const key = attemptKey(req, realm);
        if (!store.allowPasswordAttempt(key))
            return oauthError(res, 429, 'too_many_requests', 'Too many failed attempts. Try again later.');

        // constant time, so the password cannot be recovered one character at a time
        if (!realm.verifyPassword(password))
            return res.status(401).json({ status: false, code: undefined });

        store.clearPasswordAttempts(key);

        const code = store.createAuthorizationCode({
            client_id: clientId,
            realm: realm.id,
            redirect_uri: redirectUri,
            code_challenge: codeChallenge,
            code_challenge_method: codeChallengeMethod,
        });

        res.status(200).json({ status: true, code });
    });

    router.post('/token', (req, res) => {
        const realm = resolveRealm(req);
        if (!realm) return unknownRealm(res);

        const grantType = req.body?.['grant_type'];

        // a client may authenticate in the body or with Basic auth
        let clientId = req.body?.['client_id'];
        let clientSecret = req.body?.['client_secret'];

        const authHeader = req.headers['authorization'];
        if (typeof authHeader === 'string' && authHeader.startsWith('Basic ')) {
            const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
            const separator = decoded.indexOf(':');
            if (separator !== -1) {
                clientId = decoded.slice(0, separator);
                clientSecret = decoded.slice(separator + 1);
            }
        }

        if (!clientId)
            return oauthError(res, 401, 'invalid_client', 'No client authentication provided');

        const client = store.getClient(clientId, realm.id);
        if (!client)
            return oauthError(res, 401, 'invalid_client', 'Unknown client_id');

        // the secret used to be parsed and then thrown away without being checked
        if (!store.verifyClientSecret(clientId, realm.id, clientSecret))
            return oauthError(res, 401, 'invalid_client', 'Invalid client credentials');

        if (grantType === 'refresh_token')
            return handleRefresh(req, res, store, clientId, realm);

        if (grantType !== 'authorization_code')
            return oauthError(res, 400, 'unsupported_grant_type', 'Only authorization_code and refresh_token grant types are supported');

        const code = req.body?.['code'];
        const redirectUri = req.body?.['redirect_uri'];
        const codeVerifier = req.body?.['code_verifier'];

        if (!code || !redirectUri || !codeVerifier)
            return oauthError(res, 400, 'invalid_request', 'Missing required parameters');

        const authCode = store.consumeAuthorizationCode(code);
        if (!authCode)
            return oauthError(res, 400, 'invalid_grant', 'Invalid or expired authorization code');

        if (authCode.client_id !== clientId || authCode.redirect_uri !== redirectUri)
            return oauthError(res, 400, 'invalid_grant', 'Authorization code mismatch');

        // a code made under one profile must not be spent under another
        if (authCode.realm !== realm.id)
            return oauthError(res, 400, 'invalid_grant', 'Authorization code was issued for a different profile');

        if (!verifyPKCE(codeVerifier, authCode.code_challenge, authCode.code_challenge_method))
            return oauthError(res, 400, 'invalid_grant', 'Invalid code verifier');

        return respondWithTokens(res, store, clientId, realm);
    });
}

function handleRefresh(req: express.Request, res: express.Response, store: AuthStore, clientId: string, realm: Realm) {
    const presented = req.body?.['refresh_token'];
    if (!presented)
        return oauthError(res, 400, 'invalid_request', 'Missing refresh_token');

    const entry = store.consumeRefreshToken(presented);
    if (!entry)
        return oauthError(res, 400, 'invalid_grant', 'Invalid or expired refresh token');

    if (entry.client_id !== clientId)
        return oauthError(res, 400, 'invalid_grant', 'Refresh token was issued to a different client');

    if (entry.realm !== realm.id)
        return oauthError(res, 400, 'invalid_grant', 'Refresh token was issued for a different profile');

    return respondWithTokens(res, store, clientId, realm);
}

function respondWithTokens(res: express.Response, store: AuthStore, clientId: string, realm: Realm) {
    const { accessToken, refreshToken, expiresInSeconds } = store.issueTokens(clientId, realm.id);

    // tokens must never be cached by an intermediary
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: expiresInSeconds,
        refresh_token: refreshToken,
    });
}
