import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const APP_VERSION = '4.5.0-matrix';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const APP_ENV = import.meta.env.MODE || 'development';

class RyanAIClient {
  private baseURL: string;
  private version: string;

  constructor(baseURL: string, version: string) {
    this.baseURL = baseURL;
    this.version = version;
    console.log(`🚀 RyanAI Client initialized | API: ${baseURL} | Version: ${version}`);
  }

  async request<T = unknown>(
    endpoint: string,
    options: RequestInit & { method?: string } = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const method = options.method || 'GET';

    try {
      const response = await fetch(url, {
        ...options,
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-App-Version': this.version,
          ...options.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      console.error(`API Request Failed: ${method} ${endpoint}`, error);
      throw error;
    }
  }

  async executePipeline(targetEnv: string, autoShip: boolean) {
    return this.request('/api/pipeline/execute', {
      method: 'POST',
      body: JSON.stringify({ targetEnv, autoShip }),
    });
  }

  async getPipelineStatus() {
    return this.request('/api/pipeline/status');
  }

  async getGovernanceErrors(filter?: string) {
    return this.request(`/api/governance/errors${filter ? `?filter=\${filter}` : ''}`);
  }

  async applyAutoFix(errorId: string) {
    return this.request(`/api/governance/fix/${errorId}`, { method: 'POST' });
  }

  async getRecycledItems(category?: string) {
    return this.request(`/api/recycling/items${category ? `?category=\${category}` : ''}`);
  }

  async restoreRecycledItem(itemId: string) {
    return this.request(`/api/recycling/restore/${itemId}`, { method: 'POST' });
  }

  async getTelemetry() {
    return this.request('/api/telemetry');
  }

  async runDiagnosticSweep() {
    return this.request('/api/telemetry/diagnostic', { method: 'POST' });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseURL}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

const apiClient = new RyanAIClient(API_BASE_URL, APP_VERSION);

declare global {
  interface Window {
    ryanai: {
      client: RyanAIClient;
      version: string;
      apiUrl: string;
    };
    __DEV__?: {
      apiClient: RyanAIClient;
      logs: Console;
      simulatePipeline: () => Promise<unknown>;
      simulateError: (errorId: string) => Promise<unknown>;
      checkHealth: () => Promise<boolean>;
    };
  }
}

window.ryanai = {
  client: apiClient,
  version: APP_VERSION,
  apiUrl: API_BASE_URL,
};

const initializeSentry = () => {
  const sentryDSN = import.meta.env.VITE_SENTRY_DSN;
  if (sentryDSN && APP_ENV === 'production') {
    console.log('🔍 Initializing Sentry error tracking...');
  }
};

const performHealthCheck = async (): Promise<boolean> => {
  try {
    const healthy = await apiClient.healthCheck();
    if (healthy) {
      console.log('✅ Backend health check passed');
      return true;
    }
    console.warn('⚠️ Backend health check failed');
    return false;
  } catch (error) {
    console.warn('⚠️ Backend health check failed (will retry):', error);
    return false;
  }
};

const initializeApp = async () => {
  try {
    initializeSentry();
    await performHealthCheck();

    const rootElement = document.getElementById('root');
    if (!rootElement) {
      throw new Error('Root element not found in DOM');
    }

    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );

    console.log(
      '%c✅ RyanAI Command Center v4.5.0-matrix Ready',
      'font-size: 14px; color: #00ff66; font-weight: bold; text-shadow: 0 0 10px #00ff66;'
    );
  } catch (error) {
    console.error('❌ Failed to initialize RyanAI Command Center:', error);
    throw error;
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp().catch(console.error);
}

if (import.meta.hot) {
  import.meta.hot.accept('./App', () => {
    console.log('🔄 Hot module replacement triggered');
  });
}

if (APP_ENV === 'development') {
  window.__DEV__ = {
    apiClient,
    logs: console,
    simulatePipeline: async () => apiClient.executePipeline('production', true),
    simulateError: async (errorId: string) => apiClient.applyAutoFix(errorId),
    checkHealth: performHealthCheck,
  };
}
