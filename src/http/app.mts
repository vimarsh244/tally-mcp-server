/**
 * Builds the express app. Kept separate from listening so tests can drive it.
 */

import express from 'express';
import { config } from '../config.mjs';
import { AuthStore } from './store.mjs';
import { registerOAuthRoutes } from './oauth.mjs';
import { registerMcpRoutes } from './mcp-route.mjs';

export interface HttpApp {
    app: express.Express;
    store: AuthStore;
    /** Stops the background expiry sweep. */
    close(): void;
}

export interface AppOptions {
    /** Host headers the MCP endpoint accepts. Defaults to the configured domain plus loopback. */
    allowedHosts?: string[];
}

export function createApp(publicDir: string, options: AppOptions = {}): HttpApp {
    const app = express();
    const store = new AuthStore();

    // a body far larger than any MCP message is a denial of service, not a request
    app.use(express.json({ limit: '4mb' }));
    app.use(express.urlencoded({ extended: true, limit: '4mb' }));

    app.disable('x-powered-by');
    app.set('trust proxy', process.env.TRUST_PROXY === '1');

    app.use((_req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        next();
    });

    registerOAuthRoutes(app, store, publicDir);
    registerMcpRoutes(app, store, { allowedHosts: options.allowedHosts });

    const sweep = setInterval(() => store.sweep(), 60000);
    sweep.unref?.();

    return { app, store, close: () => clearInterval(sweep) };
}

export { config };
