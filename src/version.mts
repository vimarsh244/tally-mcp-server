/**
 * Single source for the server identity.
 *
 * The version used to be typed a second time in mcp.mts and drifted to 7.0.0
 * while package.json and manifest.json were at 7.6.0.
 */

import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export const serverInfo = {
    name: 'Tally Prime MCP Server',
    title: 'Tally Prime',
    version: pkg.version,
} as const;
