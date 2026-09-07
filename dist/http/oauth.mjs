/**
 * OAuth 2.1 endpoints: discovery, dynamic registration, authorization, token.
 */
import path from 'node:path';
import { config } from '../config.mjs';
import { isValidRedirectUri, safeEquals, verifyPKCE } from './store.mjs';
const oauthError = (res, status, error, description) => res.status(status).json({ error, error_description: description });
/** The address a request came from, used to rate limit password attempts. */
const clientKey = (req) => req.ip ?? req.socket.remoteAddress ?? 'unknown';
export function registerOAuthRoutes(app, store, publicDir) {
    const domain = config.domain;
    const protectedResource = (_req, res) => {
        res.status(200).json({
            resource: `${domain}/mcp`,
            authorization_servers: [domain],
            bearer_methods_supported: ['header'],
            scopes_supported: ['email'],
        });
    };
    app.get('/.well-known/oauth-protected-resource', protectedResource);
    app.get('/.well-known/oauth-protected-resource/mcp', protectedResource);
    app.get('/.well-known/oauth-authorization-server', (_req, res) => {
        res.status(200).json({
            issuer: domain,
            authorization_endpoint: `${domain}/authorize`,
            token_endpoint: `${domain}/token`,
            registration_endpoint: `${domain}/register`,
            response_types_supported: ['code'],
            response_modes_supported: ['query'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
            code_challenge_methods_supported: ['S256'],
        });
    });
    app.post('/register', (req, res) => {
        const redirectUris = req.body?.['redirect_uris'];
        if (!Array.isArray(redirectUris) || redirectUris.length === 0)
            return oauthError(res, 400, 'invalid_client_metadata', 'redirect_uris must be a non-empty array');
        // an unchecked redirect_uri turns the authorize endpoint into an open redirect
        if (!redirectUris.every(isValidRedirectUri))
            return oauthError(res, 400, 'invalid_redirect_uri', 'every redirect_uri must be an absolute http or https URL without a fragment');
        const clientName = typeof req.body?.['client_name'] === 'string' ? req.body['client_name'] : 'Unnamed Client';
        const client = store.registerClient(clientName, redirectUris);
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
    app.get('/authorize', (req, res) => {
        const clientId = req.query.client_id;
        const redirectUri = req.query.redirect_uri;
        const codeChallenge = req.query.code_challenge;
        const codeChallengeMethod = req.query.code_challenge_method;
        const responseType = req.query.response_type;
        if (!clientId || !redirectUri || !codeChallenge || !responseType)
            return oauthError(res, 400, 'invalid_request', 'Missing required parameters');
        if (responseType !== 'code')
            return oauthError(res, 400, 'unsupported_response_type', 'Only "code" response type is supported');
        if (codeChallengeMethod !== 'S256')
            return oauthError(res, 400, 'invalid_request', 'Only S256 code challenge method is supported');
        const client = store.getClient(clientId);
        if (!client)
            return oauthError(res, 400, 'invalid_client', 'Unknown client_id');
        if (!client.redirect_uris.includes(redirectUri))
            return oauthError(res, 400, 'invalid_request', 'Invalid redirect_uri');
        res.status(200).header('Content-Type', 'text/html').sendFile(path.join(publicDir, 'authorize.html'));
    });
    // The password submission behind the consent page.
    app.post('/authorize', (req, res) => {
        const clientId = req.body?.['client_id'];
        const redirectUri = req.body?.['redirect_uri'];
        const codeChallenge = req.body?.['code_challenge'];
        const codeChallengeMethod = req.body?.['code_challenge_method'];
        const password = req.body?.['password'];
        if (!clientId || typeof password !== 'string')
            return oauthError(res, 400, 'invalid_request', 'Missing client_id or password');
        // the client and its redirect_uri are checked here too, not only on the GET
        const client = store.getClient(clientId);
        if (!client)
            return oauthError(res, 400, 'invalid_client', 'Unknown client_id');
        if (!client.redirect_uris.includes(redirectUri))
            return oauthError(res, 400, 'invalid_request', 'Invalid redirect_uri');
        if (codeChallengeMethod !== 'S256' || !codeChallenge)
            return oauthError(res, 400, 'invalid_request', 'Only S256 code challenge method is supported');
        const key = clientKey(req);
        if (!store.allowPasswordAttempt(key))
            return oauthError(res, 429, 'too_many_requests', 'Too many failed attempts. Try again later.');
        // constant time, so the password cannot be recovered one character at a time
        if (!safeEquals(config.password, password))
            return res.status(401).json({ status: false, code: undefined });
        store.clearPasswordAttempts(key);
        const code = store.createAuthorizationCode({
            client_id: clientId,
            redirect_uri: redirectUri,
            code_challenge: codeChallenge,
            code_challenge_method: codeChallengeMethod,
        });
        res.status(200).json({ status: true, code });
    });
    app.post('/token', (req, res) => {
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
        const client = store.getClient(clientId);
        if (!client)
            return oauthError(res, 401, 'invalid_client', 'Unknown client_id');
        // the secret used to be parsed and then thrown away without being checked
        if (!store.verifyClientSecret(clientId, clientSecret))
            return oauthError(res, 401, 'invalid_client', 'Invalid client credentials');
        if (grantType === 'refresh_token')
            return handleRefresh(req, res, store, clientId);
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
        if (!verifyPKCE(codeVerifier, authCode.code_challenge, authCode.code_challenge_method))
            return oauthError(res, 400, 'invalid_grant', 'Invalid code verifier');
        return respondWithTokens(res, store, clientId);
    });
}
function handleRefresh(req, res, store, clientId) {
    const presented = req.body?.['refresh_token'];
    if (!presented)
        return oauthError(res, 400, 'invalid_request', 'Missing refresh_token');
    const entry = store.consumeRefreshToken(presented);
    if (!entry)
        return oauthError(res, 400, 'invalid_grant', 'Invalid or expired refresh token');
    if (entry.client_id !== clientId)
        return oauthError(res, 400, 'invalid_grant', 'Refresh token was issued to a different client');
    return respondWithTokens(res, store, clientId);
}
function respondWithTokens(res, store, clientId) {
    const { accessToken, refreshToken, expiresInSeconds } = store.issueTokens(clientId);
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
//# sourceMappingURL=oauth.mjs.map