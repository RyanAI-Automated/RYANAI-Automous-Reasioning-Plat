import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './index.js';

const server = createMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);
console.error('RyanAI MCP Manager Server running on stdio');
