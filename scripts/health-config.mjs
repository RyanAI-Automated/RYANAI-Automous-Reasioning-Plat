import { config } from 'dotenv';

config({ quiet: true });

// --local deliberately overrides Compose URLs saved in older .env files.
const local = process.argv.includes('--local');
const PORT = process.env.PORT || '3001';
const HOST = process.env.HOST || 'localhost';

export const apiUrl = (local
  ? `http://localhost:${process.env.PORT || 3001}`
  : process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
export const webUrl = (local
  ? `http://localhost:${process.env.VITE_PORT || 1420}`
  : process.env.WEB_BASE_URL || 'http://localhost:9090').replace(/\/+$/, '');
export const apiHealthUrl = local ? `${apiUrl}/health` : process.env.API_HEALTH_URL || `${apiUrl}/health`;
export const mcpHealthUrl = process.env.MCP_HEALTH_URL;



export const apiUrl = process.env.API_URL || process.env.BASE_URL || `http://${HOST}:${PORT}`;
export const webUrl = process.env.WEB_URL || 'http://localhost:1420';
export const apiHealthUrl = `${apiUrl}/health`;
export const mcpHealthUrl = process.env.MCP_HEALTH_URL || 'http://127.0.0.1:8765/mcp';
