/** Starts the express app on an ephemeral port and returns a small client. */
import { createApp } from '../dist/http/app.mjs';
import crypto from 'node:crypto';
import http from 'node:http';

/**
 * A raw request, because fetch treats Host as a forbidden header and silently
 * drops any override, which would make a Host based test pass vacuously.
 */
export function rawRequest(port, { method = 'POST', path = '/mcp', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request({
            host: '127.0.0.1', port, path, method,
            headers: {
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...headers,
            },
        }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; });
            res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

export async function startHttp() {
    const publicDir = new URL('..', import.meta.url).pathname;

    // The port is only known after listening, and the transport reads this array
    // per request, so the real host is appended once the port is assigned.
    const allowedHosts = [];
    const { app, store, close } = createApp(publicDir, { allowedHosts });

    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    allowedHosts.push(`127.0.0.1:${port}`, `localhost:${port}`);
    const base = `http://127.0.0.1:${port}`;

    const call = async (method, pathname, { body, headers = {}, form } = {}) => {
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
    };

    return {
        base, store, call, allowedHosts, port,
        close: async () => { close(); await new Promise((r) => server.close(r)); },
    };
}

/** Registers a client and completes the whole OAuth flow, returning its tokens. */
export async function authenticate(http, { password = 'password', redirectUri = 'https://example.com/cb' } = {}) {
    const reg = await http.call('POST', '/register', {
        body: { client_name: 'test', redirect_uris: [redirectUri] },
    });

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    const auth = await http.call('POST', '/authorize', {
        form: {
            client_id: reg.json.client_id,
            redirect_uri: redirectUri,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            password,
        },
    });

    const token = await http.call('POST', '/token', {
        form: {
            grant_type: 'authorization_code',
            code: auth.json?.code,
            redirect_uri: redirectUri,
            client_id: reg.json.client_id,
            client_secret: reg.json.client_secret,
            code_verifier: verifier,
        },
    });

    return { client: reg.json, verifier, challenge, redirectUri, code: auth.json?.code, tokens: token.json, authStatus: auth.status, tokenStatus: token.status };
}

export const INITIALIZE = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
    },
};

/** Opens an MCP session and returns its id. */
export async function openSession(http, accessToken) {
    const res = await http.call('POST', '/mcp', {
        body: INITIALIZE,
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json, text/event-stream' },
    });
    return { sessionId: res.headers.get('mcp-session-id'), status: res.status, text: res.text };
}
