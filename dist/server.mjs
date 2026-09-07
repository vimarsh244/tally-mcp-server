/**
 * HTTP entry point for the remote MCP server.
 */
import path from 'node:path';
import { assertPasswordIsSafe, config } from './config.mjs';
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
const { app } = createApp(publicDir);
app.listen(config.port, () => console.log(`MCP Server started on port ${config.port}`));
//# sourceMappingURL=server.mjs.map