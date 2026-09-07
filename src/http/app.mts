/**
 * Builds the express app. Kept separate from listening so tests can drive it.
 */

import express from 'express';
import { config } from '../config.mjs';
import type { ProfileStore } from '../profiles.mjs';
import { AuthStore } from './store.mjs';
import { registerOAuthRoutes, registerWellKnownRoutes } from './oauth.mjs';
import { registerMcpRoutes } from './mcp-route.mjs';
import { registerAdminRoutes } from './admin.mjs';
import { createRealmResolver } from './realm.mjs';

export interface HttpApp {
    app: express.Express;
    store: AuthStore;
    /** Stops the background expiry sweep. */
    close(): void;
}

export interface AppOptions {
    /** Host headers the MCP endpoint accepts. Defaults to the configured domain plus loopback. */
    allowedHosts?: string[];
    /** Turns on the per profile routes under /u/<id>. */
    profiles?: ProfileStore;
    /** Turns on the setup page. Needs profiles as well. */
    adminToken?: string;
    /** Set false only in tests that reach the setup API from a non-loopback address. */
    requireLoopbackAdmin?: boolean;
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

    const resolveRealm = createRealmResolver(options.profiles);

    // discovery sits above the mount points, because the resource path is
    // appended after /.well-known/... rather than prefixed before it
    registerWellKnownRoutes(app, resolveRealm);

    // one router, mounted twice: at the root for a single Tally deployment and
    // under /u/<id> for one profile per signed in Windows user
    const realmRouter = express.Router({ mergeParams: true });
    registerOAuthRoutes(realmRouter, store, publicDir, resolveRealm);
    registerMcpRoutes(realmRouter, store, resolveRealm, { allowedHosts: options.allowedHosts });

    app.use('/u/:profileId', realmRouter);
    app.use('/', realmRouter);

    if (options.profiles && options.adminToken)
        registerAdminRoutes(app, publicDir, {
            profiles: options.profiles,
            adminToken: options.adminToken,
            requireLoopback: options.requireLoopbackAdmin,
        });

    const sweep = setInterval(() => store.sweep(), 60000);
    sweep.unref?.();

    return { app, store, close: () => clearInterval(sweep) };
}

export { config };
