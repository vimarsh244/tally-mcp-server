/**
 * The /mcp endpoint.
 *
 * Two things changed here. Every method is authenticated, where only POST used
 * to be, so an unauthenticated caller can no longer open a session's SSE stream
 * or terminate it. And each session records the client that created it, so a
 * token issued to one client cannot drive another client's session.
 */
import crypto from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { allowedHosts, config } from '../config.mjs';
import { registerMcpServer } from '../mcp.mjs';
export function registerMcpRoutes(app, store, options = {}) {
    const sessions = new Map();
    const hosts = options.allowedHosts ?? allowedHosts();
    const unauthorized = (res, message) => {
        // points the caller at the metadata that says how to authenticate
        res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${config.domain}/.well-known/oauth-protected-resource"`);
        res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32000, message },
            id: null,
        });
    };
    /** Returns the authenticated client id, or null once a 401 has been sent. */
    const authenticate = (req, res) => {
        const header = req.headers['authorization'];
        if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
            unauthorized(res, 'Unauthorized: No valid authentication token provided');
            return null;
        }
        const token = store.verifyAccessToken(header.slice(7).trim());
        if (!token) {
            unauthorized(res, 'Unauthorized: No valid authentication token provided');
            return null;
        }
        return token.client_id;
    };
    /**
     * Resolves the session named by the header, but only for the client that
     * owns it. An unknown session and someone else's session are reported the
     * same way, so the header cannot be used to probe for live sessions.
     */
    const sessionFor = (req, clientId) => {
        const sessionId = req.headers['mcp-session-id'];
        if (typeof sessionId !== 'string')
            return undefined;
        const session = sessions.get(sessionId);
        if (!session || session.clientId !== clientId)
            return undefined;
        return session;
    };
    app.post('/mcp', async (req, res) => {
        const clientId = authenticate(req, res);
        if (!clientId)
            return;
        const existing = sessionFor(req, clientId);
        if (existing) {
            await existing.transport.handleRequest(req, res, req.body);
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
            onsessioninitialized: (sessionId) => { sessions.set(sessionId, { transport, clientId }); },
            // the option is inert unless protection is switched on, which it was not
            enableDnsRebindingProtection: true,
            allowedHosts: hosts,
        });
        transport.onclose = () => {
            if (transport.sessionId)
                sessions.delete(transport.sessionId);
        };
        const mcpServer = await registerMcpServer();
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });
    // GET opens the notification stream and DELETE ends the session. Both used to
    // accept any caller that could name a session id.
    const handleSessionRequest = async (req, res) => {
        const clientId = authenticate(req, res);
        if (!clientId)
            return;
        const session = sessionFor(req, clientId);
        if (!session) {
            res.status(400).send('Invalid or missing session ID');
            return;
        }
        await session.transport.handleRequest(req, res);
    };
    app.get('/mcp', handleSessionRequest);
    app.delete('/mcp', handleSessionRequest);
}
//# sourceMappingURL=mcp-route.mjs.map