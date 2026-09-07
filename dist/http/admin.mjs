/**
 * The setup page and the small API behind it.
 *
 * This is how an administrator turns a fresh install into working connections:
 * find the running copies of Tally, make one profile per person, and read back
 * the URL and token that person pastes into their chat client.
 *
 * Two guards protect it. The request must come from this machine, and it must
 * carry the admin token that the service wrote to its data folder on first
 * start. Loopback alone is not enough, because a Windows Server has several
 * people signed in at once.
 */
import path from 'node:path';
import express from 'express';
import { config } from '../config.mjs';
import { PROFILE_ID_PATTERN, safeEqualsHex } from '../profiles.mjs';
import { queryCollection } from '../tally/index.mjs';
import { runWithTallyTarget } from '../tally-target.mjs';
import { profilePath } from './realm.mjs';
/** A scan touches many ports, so it must not wait the full Tally timeout on each. */
const PROBE_TIMEOUT_MS = 2500;
const MAX_SCAN_PORTS = 64;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLoopback = (address) => typeof address === 'string' && LOOPBACK.has(address);
/** Asks one address whether a Tally is there, and which companies it has open. */
export async function probeTally(host, port, timeout = PROBE_TIMEOUT_MS) {
    try {
        const rows = await runWithTallyTarget({ host, port, timeout }, () => queryCollection('Company', ['Name', 'IsActiveCompany'], new Map()));
        return {
            host,
            port,
            reachable: true,
            companies: rows.map((row) => ({ name: String(row.Name ?? ''), active: row.IsActiveCompany === true })),
        };
    }
    catch (err) {
        return {
            host,
            port,
            reachable: false,
            companies: [],
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
export function registerAdminRoutes(app, publicDir, options) {
    const { profiles, adminToken, requireLoopback = true } = options;
    // the page itself carries no secret; it prompts for the token and calls the API
    app.get('/admin', (req, res) => {
        if (requireLoopback && !isLoopback(req.socket.remoteAddress))
            return res.status(403).send('The setup page is available on this machine only.');
        res.status(200).header('Content-Type', 'text/html').sendFile(path.join(publicDir, 'admin.html'));
    });
    const api = express.Router();
    api.use((req, res, next) => {
        if (requireLoopback && !isLoopback(req.socket.remoteAddress))
            return res.status(403).json({ error: 'The setup API is available on this machine only' });
        const presented = req.header('x-admin-token') ?? '';
        if (!safeEqualsHex(adminToken, presented))
            return res.status(401).json({ error: 'Invalid admin token' });
        next();
    });
    const connectUrl = (id) => `${config.domain}${profilePath(id)}/mcp`;
    const withUrls = (id) => ({ url: connectUrl(id), setupUrl: `${config.domain}${profilePath(id)}` });
    api.get('/state', (_req, res) => {
        res.json({
            domain: config.domain,
            port: config.port,
            multiUser: config.multiUser,
            dataDir: profiles.dir,
            profiles: profiles.list().map((profile) => ({ ...profile, ...withUrls(profile.id) })),
        });
    });
    api.post('/profiles', (req, res) => {
        try {
            const { profile, token } = profiles.create({
                id: String(req.body?.id ?? '').trim().toLowerCase(),
                label: req.body?.label,
                windowsUser: req.body?.windowsUser,
                tallyHost: req.body?.tallyHost,
                tallyPort: Number(req.body?.tallyPort),
                dataPath: req.body?.dataPath,
                blockWrite: req.body?.blockWrite !== false,
                password: String(req.body?.password ?? ''),
            });
            // the token is returned here and nowhere else; only its hash is kept
            res.status(200).json({ profile: { ...profile, ...withUrls(profile.id) }, token });
        }
        catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    api.patch('/profiles/:id', (req, res) => {
        try {
            const patch = {};
            for (const key of ['label', 'windowsUser', 'tallyHost', 'dataPath'])
                if (req.body?.[key] !== undefined)
                    patch[key] = String(req.body[key]);
            if (req.body?.tallyPort !== undefined)
                patch.tallyPort = Number(req.body.tallyPort);
            if (req.body?.blockWrite !== undefined)
                patch.blockWrite = req.body.blockWrite === true;
            if (req.body?.password !== undefined)
                patch.password = String(req.body.password);
            const profile = profiles.update(req.params.id, patch);
            res.json({ profile: { ...profile, ...withUrls(profile.id) } });
        }
        catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    api.post('/profiles/:id/token', (req, res) => {
        try {
            res.json({ token: profiles.rotateToken(req.params.id) });
        }
        catch (err) {
            res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    api.delete('/profiles/:id', (req, res) => {
        if (!profiles.remove(req.params.id))
            return res.status(404).json({ error: `No profile named ${req.params.id}` });
        res.json({ removed: true });
    });
    /** Walks a port range and reports every address that answered as Tally. */
    api.post('/scan', async (req, res) => {
        const host = String(req.body?.host ?? '127.0.0.1');
        const from = Number(req.body?.fromPort ?? 9000);
        const to = Number(req.body?.toPort ?? 9010);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 65535 || to < from)
            return res.status(400).json({ error: 'The port range must be two whole numbers between 1 and 65535' });
        if (to - from + 1 > MAX_SCAN_PORTS)
            return res.status(400).json({ error: `A scan covers at most ${MAX_SCAN_PORTS} ports at a time` });
        const ports = Array.from({ length: to - from + 1 }, (_unused, index) => from + index);
        // probed together, or a range of dead ports would take the timeout once per port
        const results = await Promise.all(ports.map((port) => probeTally(host, port)));
        res.json({ results: results.filter((result) => result.reachable) });
    });
    /** Tests one address, so a profile can be checked before it is saved. */
    api.post('/probe', async (req, res) => {
        const host = String(req.body?.host ?? '127.0.0.1');
        const port = Number(req.body?.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535)
            return res.status(400).json({ error: 'The port must be a whole number between 1 and 65535' });
        res.json(await probeTally(host, port));
    });
    app.use('/admin/api', api);
}
export { PROFILE_ID_PATTERN };
//# sourceMappingURL=admin.mjs.map