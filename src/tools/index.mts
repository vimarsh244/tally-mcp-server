/**
 * Builds the MCP server and registers every tool module.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config.mjs';
import { ResultCache } from '../database.mjs';
import { serverInfo } from '../version.mjs';
import type { ToolContext, ToolModule } from './shared.mjs';

import { metadataTools } from './metadata.mjs';
import { queryTools } from './query.mjs';
import { statementTools } from './statements.mjs';
import { ledgerTools } from './ledgers.mjs';
import { inventoryTools } from './inventory.mjs';
import { contextTools } from './context.mjs';
import { writeTools } from './write.mjs';

/** Read only modules, always registered. */
const readModules: ToolModule[] = [
    metadataTools,
    queryTools,
    statementTools,
    ledgerTools,
    inventoryTools,
    contextTools,
];

/** Modules hidden when BLOCK_WRITE is set. */
const writeModules: ToolModule[] = [writeTools];

export async function registerMcpServer(): Promise<McpServer> {
    const server = new McpServer(serverInfo);
    const context: ToolContext = { server, cache: await ResultCache.create() };

    for (const register of readModules) register(context);
    if (!config.blockWrite)
        for (const register of writeModules) register(context);

    return server;
}
