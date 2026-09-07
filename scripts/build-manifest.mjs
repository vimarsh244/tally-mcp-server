/**
 * Syncs the `tools` array in manifest.json with the tools the server registers.
 *
 * The list used to be maintained by hand, so delete-master shipped in v7.4
 * without ever being added and extension users saw a stale list. The version
 * field is taken from package.json for the same reason.
 *
 * Run with `pnpm build:manifest`, or `pnpm build`, which runs it last.
 * Pass --check to fail instead of writing, for use in CI.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const manifestPath = join(root, 'manifest.json');
const check = process.argv.includes('--check');

// BLOCK_WRITE would hide the write tools, and the manifest must list them all
delete process.env.BLOCK_WRITE;

const { registerMcpServer } = await import(join(root, 'dist', 'mcp.mjs'));
const server = await registerMcpServer();

// _registeredTools is internal to the SDK, but it is the only place the
// registered titles and descriptions are readable. A rename breaks the build
// loudly rather than silently emitting an empty list.
const registered = server._registeredTools;
if (!registered || Object.keys(registered).length === 0)
    throw new Error('No registered tools found. Has the MCP SDK changed its internals?');

const tools = Object.entries(registered).map(([name, tool]) => ({
    name,
    description: tool.description,
}));

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const updated = { ...manifest, version: pkg.version, tools };
const serialised = JSON.stringify(updated, null, 2) + '\n';

if (check) {
    if (readFileSync(manifestPath, 'utf8') !== serialised) {
        console.error('manifest.json is out of date. Run `pnpm build:manifest`.');
        process.exit(1);
    }
    console.log(`manifest: up to date (${tools.length} tools)`);
} else {
    writeFileSync(manifestPath, serialised);
    console.log(`manifest: wrote ${tools.length} tools at version ${pkg.version}`);
}

process.exit(0);
