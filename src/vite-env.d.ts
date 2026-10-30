/// <reference types="vite/client" />

// Raw HTML module import declarations
declare module '*.html?raw' {
  const content: string;
  export default content;
}

// Strongly-typed Vite environment variables
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_RYANAI_OWNER_EMAIL?: string;
  readonly VITE_TELEMETRY_WS_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Global window extensions
interface Window {
  __RYANAI_INDEX_HTML__?: string;
}