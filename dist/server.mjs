/**
 * HTTP entry point for the remote MCP server.
 */
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import { assertPasswordIsSafe, config } from './config.mjs';
import { defaultDataDir, ensureAdminToken, ProfileStore } from './profiles.mjs';
import { createApp } from './http/app.mjs';
try {
    assertPasswordIsSafe();
}
catch (err) {
    // a configuration mistake deserves a readable line, not a stack trace
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
}
const publicDir = path.join(import.meta.dirname, '..');
const options = {};
if (config.multiUser) {
    const dataDir = config.dataDir || defaultDataDir();
    options.profiles = new ProfileStore(dataDir);
    options.adminToken = ensureAdminToken(dataDir);
}
const { app } = createApp(publicDir, options);
const server = config.tlsPfxPath
    ? https.createServer({
        pfx: fs.readFileSync(config.tlsPfxPath),
        passphrase: config.tlsPfxPassword,
    }, app)
    : app;
server.listen(config.port, config.bindHost, () => {
    const protocol = config.tlsPfxPath ? 'https' : 'http';
    console.log(`MCP Server started on ${protocol}://${config.bindHost}:${config.port}`);
    if (!options.profiles)
        return;
    console.log(`Profiles: ${options.profiles.list().length} in ${options.profiles.dir}`);
    console.log(`Setup page: ${config.domain}/admin`);
    if (options.profiles.isEmpty)
        console.log('No profiles yet. Open the setup page to add one for each Tally user.');
});
//# sourceMappingURL=server.mjs.map