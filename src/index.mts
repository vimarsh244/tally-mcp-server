import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerMcpServer } from './mcp.mjs'

const mcpServer = await registerMcpServer();
const transport = new StdioServerTransport(); // receives on stdin, sends on stdout
await mcpServer.connect(transport);
