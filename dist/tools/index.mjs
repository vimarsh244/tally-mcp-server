/**
 * Builds the MCP server and registers every tool module.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config.mjs';
import { ResultCache } from '../database.mjs';
import { serverInfo } from '../version.mjs';
import { metadataTools } from './metadata.mjs';
import { queryTools } from './query.mjs';
import { statementTools } from './statements.mjs';
import { ledgerTools } from './ledgers.mjs';
import { inventoryTools } from './inventory.mjs';
import { contextTools } from './context.mjs';
import { writeTools } from './write.mjs';
/** Read only modules, always registered. */
const readModules = [
    metadataTools,
    queryTools,
    statementTools,
    ledgerTools,
    inventoryTools,
    contextTools,
];
/** Modules hidden when BLOCK_WRITE is set. */
const writeModules = [writeTools];
export async function registerMcpServer(options = {}) {
    const server = new McpServer(serverInfo);
    const context = { server, cache: await ResultCache.create() };
    const blockWrite = options.blockWrite ?? config.blockWrite;
    for (const register of readModules)
        register(context);
    if (!blockWrite)
        for (const register of writeModules)
            register(context);
    return server;
}
//# sourceMappingURL=index.mjs.map