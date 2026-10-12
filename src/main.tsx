import { authenticatedFetch } from '@/lib/authenticatedFetch';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { API_BASE_URL } from './lib/apiBaseUrl';
import { getPlatformHealth } from './lib/platformHealth';
import ErrorBoundary from './components/ErrorBoundary';

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

const APP_VERSION = '4.5.0-matrix';
const APP_ENV = import.meta.env.MODE;

class RyanAIClient {
  private baseURL: string;
  private version: string;

  constructor(baseURL: string, version: string) {
    this.baseURL = baseURL;
    this.version = version;
    console.log(
      `🚀 RyanAI Client initialized | API: ${baseURL} | Version: ${version}`,
    );
  }

  /**
   * Make API request
   */
  async request<T = unknown>(
    endpoint: string,
    options: RequestInit & { method?: string } = {},
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const method = options.method || 'GET';
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type'))
      headers.set('Content-Type', 'application/json');
    if (!headers.has('X-App-Version'))
      headers.set('X-App-Version', this.version);
    const response = await authenticatedFetch(url, { ...options, method, headers });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    return response.json() as Promise<T>;
  }

  /**
   * Pipeline Orchestration
   */
  async executePipeline(targetEnv: string, autoShip: boolean) {
    return this.request('/api/pipeline/execute', {
      method: 'POST',
      body: JSON.stringify({ targetEnv, autoShip }),
    });
  }

  /**
   * Get Pipeline Status
   */
  async getPipelineStatus() {
    return this.request('/api/pipeline/status');
  }

  /**
   * Get Governance Errors
   */
  async getGovernanceErrors(filter?: string) {
    return this.request(
      `/api/governance/errors${filter ? `?filter=${filter}` : ''}`,
    );
  }

  /**
   * Apply Auto-Fix
   */
  async applyAutoFix(errorId: string) {
    return this.request(`/api/governance/fix/${errorId}`, { method: 'POST' });
  }

  /**
   * Get Recycled Items
   */
  async getRecycledItems(category?: string) {
    return this.request(
      `/api/recycling/items${category ? `?category=${category}` : ''}`,
    );
  }

  /**
   * Restore Recycled Item
   */
  async restoreRecycledItem(itemId: string) {
    return this.request(`/api/recycling/restore/${itemId}`, { method: 'POST' });
  }

  /**
   * Get Telemetry
   */
  async getTelemetry() {
    return this.request('/api/telemetry');
  }

  /**
   * Run Diagnostic Sweep
   */
  async runDiagnosticSweep() {
    return this.request('/api/telemetry/diagnostic', { method: 'POST' });
  }

  /**
   * Health Check
   */
  async healthCheck() {
    return getPlatformHealth();
  }
}

const apiClient = new RyanAIClient(API_BASE_URL, APP_VERSION);

declare global {
  interface Window {
    __DEV__?: {
      apiClient: RyanAIClient;
      logs: Console;
      simulatePipeline: () => Promise<unknown>;
      simulateError: (errorId: string) => Promise<unknown>;
      checkHealth: () => Promise<boolean>;
    };
    ryanai: {
      client: RyanAIClient;
      version: string;
      apiUrl: string;
    };
  }
}

window.ryanai = {
  client: apiClient,
  version: APP_VERSION,
  apiUrl: API_BASE_URL,
};

// ============================================================================
// ERROR TRACKING (OPTIONAL SENTRY)
// ============================================================================

const initializeSentry = () => {
  const sentryDSN = import.meta.env.VITE_SENTRY_DSN;
  if (sentryDSN && APP_ENV === 'production') {
    console.log('🔍 Initializing Sentry error tracking...');
    // Sentry initialization hook
  }
};

// ============================================================================
// OPTIONAL BACKEND HEALTH CHECK
// ============================================================================

const performHealthCheck = async (): Promise<boolean> => {
  try {
    await apiClient.healthCheck();
    console.log('✅ Backend health check passed');
    return true;
  } catch (error) {
    console.warn('⚠️ Backend health check failed:', error);
    return false;
  }
};

// ============================================================================
// INITIALIZE REACT APPLICATION
// ============================================================================

const initializeApp = async () => {
  try {
    initializeSentry();

    const rootElement = document.getElementById('root');
    if (!rootElement) {
      throw new Error('Root element not found in DOM');
    }

    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );

    console.log(
      '%c✅ RyanAI Command Center v4.5.0-matrix Ready',
      'font-size: 14px; color: #00ff66; font-weight: bold; text-shadow: 0 0 10px #00ff66;',
    );
    console.log(
      `%c📍 API: ${API_BASE_URL}`,
      'color: #00f3ff; font-family: monospace; font-size: 12px;',
    );

    const backendHealthy = await performHealthCheck();
    if (backendHealthy) {
      console.log('🟢 Backend connection established');
    } else {
      console.log(
        '🟡 Backend unavailable - frontend operating in offline mode',
      );
    }

    window.dispatchEvent(
      new CustomEvent('ryanai-ready', {
        detail: {
          version: APP_VERSION,
          environment: APP_ENV,
          backendHealthy,
          timestamp: new Date().toISOString(),
        },
      }),
    );
  } catch (error) {
    console.error('❌ Failed to initialize RyanAI Command Center:', error);

    const rootElement = document.getElementById('root');
    if (rootElement) {
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent =
        'RyanAI could not start. Reload the page to try again.';
      rootElement.replaceChildren(message);
    }

    window.dispatchEvent(
      new CustomEvent('ryanai-error', {
        detail: {
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        },
      }),
    );

    throw error;
  }
};

// ============================================================================
// START APPLICATION
// ============================================================================

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      void initializeApp().catch(console.error);
    },
    { once: true },
  );
} else {
  initializeApp().catch(console.error);
}

// ============================================================================
// DEVELOPMENT UTILITIES
// ============================================================================

if (APP_ENV === 'development') {
  window.__DEV__ = {
    apiClient,
    logs: console,
    simulatePipeline: async () => {
      console.log('Simulating pipeline...');
      return apiClient.executePipeline('production', true);
    },
    simulateError: async (errorId: string) => {
      console.log(`Applying auto-fix to ${errorId}...`);
      return apiClient.applyAutoFix(errorId);
    },
    checkHealth: performHealthCheck,
  };

  console.log(
    '%c💻 Development Mode - Debug utilities available at window.__DEV__',
    'color: #00f3ff; font-size: 12px; font-family: monospace;',
  );
}

// ============================================================================
// EXPORT FOR TYPE SAFETY
// ============================================================================

export { apiClient, APP_VERSION, API_BASE_URL, APP_ENV };
