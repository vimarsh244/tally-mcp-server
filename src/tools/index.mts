/**
 * Builds the MCP server and registers every tool module.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config.mjs';
import { ResultCache } from '../database.mjs';
import { serverInfo } from '../version.mjs';
import { runTraced } from '../trace.mjs';
import type { ToolContext, ToolModule } from './shared.mjs';

import { metadataTools } from './metadata.mjs';
import { queryTools } from './query.mjs';
import { statementTools } from './statements.mjs';
import { ledgerTools } from './ledgers.mjs';
import { inventoryTools } from './inventory.mjs';
import { voucherTools } from './vouchers.mjs';
import { contextTools } from './context.mjs';
import { writeTools } from './write.mjs';
import { voucherWriteTools } from './voucher-write.mjs';

/** Read only modules, always registered. */
const readModules: ToolModule[] = [
    metadataTools,
    queryTools,
    statementTools,
    ledgerTools,
    inventoryTools,
    voucherTools,
    contextTools,
];

/** Modules hidden when BLOCK_WRITE is set. */
const writeModules: ToolModule[] = [writeTools, voucherWriteTools];

export interface McpServerOptions {
    /**
     * Hides the write tools. Defaults to the BLOCK_WRITE environment setting.
     * The HTTP transport passes the profile's own value, so one profile can be
     * read only while another may write.
     */
    blockWrite?: boolean;
}

/**
 * Puts every tool call inside a trace, in one place rather than in each of the
 * thirty handlers. When TRACE is off runTraced calls straight through.
 */
function traceEveryTool(server: McpServer): void {
    // registerTool is heavily overloaded, and the wrapper only has to pass the
    // arguments along, so it is typed loosely on purpose
    const register = server.registerTool.bind(server) as (...args: any[]) => any;
    (server as any).registerTool = (name: string, definition: any, handler: (...args: any[]) => any) =>
        register(name, definition, (...args: any[]) => runTraced(name, async () => handler(...args)));
}

export async function registerMcpServer(options: McpServerOptions = {}): Promise<McpServer> {
    const server = new McpServer(serverInfo);
    traceEveryTool(server);
    const context: ToolContext = { server, cache: await ResultCache.create() };
    const blockWrite = options.blockWrite ?? config.blockWrite;

    for (const register of readModules) register(context);
    if (!blockWrite)
        for (const register of writeModules) register(context);

    // the cache holds a database of its own, so a session that ends without
    // releasing it kept that database for the life of the process
    server.server.onclose = () => context.cache.close();
    const close = server.close.bind(server);
    server.close = async () => {
        await close();
        context.cache.close();
    };

    return server;
}
