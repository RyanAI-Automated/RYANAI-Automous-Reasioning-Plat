import { config } from 'dotenv';

// Load environment variables silently
config({ quiet: true });

// --local flag deliberately overrides Docker/Compose URLs with local dev ports
const local = process.argv.includes('--local');

export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = process.env.PORT || (local ? '3001' : '3000');
export const VITE_PORT = process.env.VITE_PORT || '1420';

// Consolidated URL configuration with environment fallbacks and local overrides
export const apiUrl = (local
  ? `http://${HOST}:${PORT}`
  : process.env.API_URL || process.env.API_BASE_URL || process.env.BASE_URL || `http://${HOST}:${PORT}`
).replace(/\/+\$/, '');

export const webUrl = (local
  ? `http://localhost:${VITE_PORT}`
  : process.env.WEB_URL || process.env.WEB_BASE_URL || 'http://localhost:9090'
).replace(/\/+\$/, '');

export const apiHealthUrl = process.env.API_HEALTH_URL || `${apiUrl}/health`;
export const mcpHealthUrl = process.env.MCP_HEALTH_URL || 'http://127.0.0.1:8765/mcp';
export const PORT = process.env.PORT || '3000';
export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = process.env.PORT || (local ? '3001' : '3000');
export const VITE_PORT = process.env.VITE_PORT || '1420';
const local = process.argv.includes('--local');
export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = local ? '3001' : process.env.PORT || '3000';
export const VITE_PORT = process.env.VITE_PORT || '1420';

const trim = (value) => value.replace(/\/+$/, '');
export const apiUrl = trim(local
  ? `http://127.0.0.1:${PORT}`
  : process.env.API_URL || process.env.API_BASE_URL || process.env.BASE_URL || `http://${HOST}:${PORT}`);
export const webUrl = trim(local
  ? `http://127.0.0.1:${VITE_PORT}`
  : process.env.WEB_URL || process.env.WEB_BASE_URL || 'http://127.0.0.1:9090');
export const apiHealthUrl = process.env.API_HEALTH_URL || `${apiUrl}/health`;
export const mcpHealthUrl = process.env.MCP_HEALTH_URL || 'http://127.0.0.1:8765/health';
