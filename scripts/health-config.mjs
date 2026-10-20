import { config } from 'dotenv';

// Load .env without overriding values already exported in the shell.
config({ quiet: true });

// --local deliberately overrides Compose URLs saved in older .env files and
// targets the dev servers (API on PORT/3001, Vite on VITE_PORT/1420).
const local = process.argv.includes('--local');
const trim = (value) => value.replace(/\/+$/, '');

export const PORT = process.env.PORT || (local ? '3001' : '3000');
export const VITE_PORT = process.env.VITE_PORT || '1420';

export const apiUrl = trim(
  local
    ? `http://localhost:${PORT}`
    : process.env.API_BASE_URL || process.env.API_URL || 'http://localhost:3000',
);
export const webUrl = trim(
  local
    ? `http://localhost:${VITE_PORT}`
    : process.env.WEB_BASE_URL || process.env.WEB_URL || 'http://localhost:9090',
);
export const apiHealthUrl = local
  ? `${apiUrl}/health`
  : process.env.API_HEALTH_URL || `${apiUrl}/health`;
// Optional: startup:verify only checks the MCP service when this is set.
export const mcpHealthUrl = process.env.MCP_HEALTH_URL;
