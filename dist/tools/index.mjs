/**
 * Builds the MCP server and registers every tool module.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config.mjs';
import { ResultCache } from '../database.mjs';
import { serverInfo } from '../version.mjs';
import { runTraced } from '../trace.mjs';
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
const readModules = [
    metadataTools,
    queryTools,
    statementTools,
    ledgerTools,
    inventoryTools,
    voucherTools,
    contextTools,
];
/** Modules hidden when BLOCK_WRITE is set. */
const writeModules = [writeTools, voucherWriteTools];
/**
 * Puts every tool call inside a trace, in one place rather than in each of the
 * thirty handlers. When TRACE is off runTraced calls straight through.
 */
function traceEveryTool(server) {
    // registerTool is heavily overloaded, and the wrapper only has to pass the
    // arguments along, so it is typed loosely on purpose
    const register = server.registerTool.bind(server);
    server.registerTool = (name, definition, handler) => register(name, definition, (...args) => runTraced(name, async () => handler(...args)));
}
export async function registerMcpServer(options = {}) {
    const server = new McpServer(serverInfo);
    traceEveryTool(server);
    const context = { server, cache: await ResultCache.create() };
    const blockWrite = options.blockWrite ?? config.blockWrite;
    for (const register of readModules)
        register(context);
    if (!blockWrite)
        for (const register of writeModules)
            register(context);
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
//# sourceMappingURL=index.mjs.map