/**
 * The /mcp endpoint.
 *
 * Every method is authenticated, so an unauthenticated caller cannot open a
 * session's SSE stream or terminate it. Each session records the client and the
 * realm that created it, so a token issued to one client, or under one profile,
 * cannot drive another one's session.
 *
 * The realm also decides which copy of Tally the session talks to. That target
 * is put in place around every call, because on a Windows Server each signed in
 * user runs their own Tally on their own XML port.
 */

import crypto from 'node:crypto';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { allowedHosts, config } from '../config.mjs';
import { registerMcpServer } from '../mcp.mjs';
import { runWithTallyTarget } from '../tally-target.mjs';
import type { AuthStore } from './store.mjs';
import type { Realm, RealmResolver } from './realm.mjs';

interface Session {
    transport: StreamableHTTPServerTransport;
    clientId: string;
    realm: Realm;
}

interface Caller {
    clientId: string;
    realm: Realm;
}

export interface McpRouteOptions {
    /** Host headers the endpoint accepts. Defaults to the configured domain plus loopback. */
    allowedHosts?: string[];
}

export function registerMcpRoutes(
    router: express.Router,
    store: AuthStore,
    resolveRealm: RealmResolver,
    options: McpRouteOptions = {},
): void {
    const sessions = new Map<string, Session>();
    const hosts = options.allowedHosts ?? allowedHosts();

    const unauthorized = (res: express.Response, realm: Realm | undefined, message: string) => {
        // points the caller at the metadata that says how to authenticate
        const base = realm ? `${config.domain}${realm.basePath}` : config.domain;
        res.setHeader('WWW-Authenticate',
            `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`);
        res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32000, message },
            id: null,
        });
    };

    /** Returns the caller, or null once a 401 or 404 has been sent. */
    const authenticate = (req: express.Request, res: express.Response): Caller | null => {
        const realm = resolveRealm(req);
        if (!realm) {
            res.status(404).json({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'No such profile on this server' },
                id: null,
            });
            return null;
        }

        const header = req.headers['authorization'];
        if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
            unauthorized(res, realm, 'Unauthorized: No valid authentication token provided');
            return null;
        }

        const presented = header.slice(7).trim();

        const token = store.verifyAccessToken(presented);
        // an OAuth token is bound to the realm it was issued under
        if (token && token.realm === realm.id)
            return { clientId: token.client_id, realm };

        // the long lived token, for clients that cannot run an OAuth flow
        if (realm.verifyStaticToken(presented))
            return { clientId: `static:${realm.id}`, realm };

        unauthorized(res, realm, 'Unauthorized: No valid authentication token provided');
        return null;
    };

    /**
     * Resolves the session named by the header, but only for the caller that
     * owns it. An unknown session and someone else's session are reported the
     * same way, so the header cannot be used to probe for live sessions.
     */
    const sessionFor = (req: express.Request, caller: Caller): Session | undefined => {
        const sessionId = req.headers['mcp-session-id'];
        if (typeof sessionId !== 'string') return undefined;

        const session = sessions.get(sessionId);
        if (!session) return undefined;
        if (session.clientId !== caller.clientId || session.realm.id !== caller.realm.id) return undefined;
        return session;
    };

    router.post('/mcp', async (req, res) => {
        const caller = authenticate(req, res);
        if (!caller) return;

        const existing = sessionFor(req, caller);
        if (existing) {
            await runWithTallyTarget(existing.realm.tally, () => existing.transport.handleRequest(req, res, req.body));
            return;
        }

        if (req.headers['mcp-session-id'] || !isInitializeRequest(req.body)) {
            res.status(400).json({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
                id: null,
            });
            return;
        }

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (sessionId) => {
                sessions.set(sessionId, { transport, clientId: caller.clientId, realm: caller.realm });
            },
            // the option is inert unless protection is switched on, which it was not
            enableDnsRebindingProtection: true,
            allowedHosts: hosts,
        });

        transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
        };

        // the tool list is built per session, so a read only profile never sees the write tools
        const mcpServer = await registerMcpServer({ blockWrite: caller.realm.blockWrite });
        await mcpServer.connect(transport);

        await runWithTallyTarget(caller.realm.tally, () => transport.handleRequest(req, res, req.body));
    });

    // GET opens the notification stream and DELETE ends the session. Both used to
    // accept any caller that could name a session id.
    const handleSessionRequest = async (req: express.Request, res: express.Response) => {
        const caller = authenticate(req, res);
        if (!caller) return;

        const session = sessionFor(req, caller);
        if (!session) {
            res.status(400).send('Invalid or missing session ID');
            return;
        }

        await runWithTallyTarget(session.realm.tally, () => session.transport.handleRequest(req, res));
    };

    router.get('/mcp', handleSessionRequest);
    router.delete('/mcp', handleSessionRequest);
}
