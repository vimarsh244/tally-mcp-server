/**
 * HTTP entry point for the remote MCP server.
 */

import path from 'node:path';
import { assertPasswordIsSafe, config } from './config.mjs';
import { defaultDataDir, ensureAdminToken, ProfileStore } from './profiles.mjs';
import { createApp, type AppOptions } from './http/app.mjs';

try {
    assertPasswordIsSafe();
} catch (err) {
    // a configuration mistake deserves a readable line, not a stack trace
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
}

const publicDir = path.join(import.meta.dirname, '..');
const options: AppOptions = {};

if (config.multiUser) {
    const dataDir = config.dataDir || defaultDataDir();
    options.profiles = new ProfileStore(dataDir);
    options.adminToken = ensureAdminToken(dataDir);
}

const { app } = createApp(publicDir, options);

app.listen(config.port, config.bindHost, () => {
    console.log(`MCP Server started on ${config.bindHost}:${config.port}`);

    if (!options.profiles) return;

    console.log(`Profiles: ${options.profiles.list().length} in ${options.profiles.dir}`);
    console.log(`Setup page: ${config.domain}/admin`);

    if (options.profiles.isEmpty)
        console.log('No profiles yet. Open the setup page to add one for each Tally user.');
});
