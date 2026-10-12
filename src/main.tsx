import { authenticatedFetch } from '@/lib/authenticatedFetch';
/**
 * RyanAI Command Center - Main Frontend Entry Point
 * Integrates React frontend with Fastify backend
 * Version: 4.5.0-matrix
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { API_BASE_URL } from './lib/apiBaseUrl';

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

const APP_VERSION = '4.5.0-matrix';
const APP_ENV = import.meta.env.MODE || 'development';

// ============================================================================
// GLOBAL API CLIENT
// ============================================================================

/**
 * Global API client for backend communication
 */
class RyanAIClient {
  private baseURL: string;
  private version: string;

  constructor(baseURL: string, version: string) {
    this.baseURL = baseURL;
    this.version = version;
    console.log(`🚀 RyanAI Client initialized | API: ${baseURL} | Version: ${version}`);
  }

  /**
   * Make API request
   */
  async request<T = unknown>(
    endpoint: string,
    options: RequestInit & { method?: string } = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const method = options.method || 'GET';

    try {
      const response = await authenticatedFetch(url, {
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
    return this.request(`/api/governance/errors${filter ? `?filter=${filter}` : ''}`);
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
    return this.request(`/api/recycling/items${category ? `?category=${category}` : ''}`);
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
    return this.request('/health');
  }
}

// ============================================================================
// INITIALIZE GLOBAL CLIENT
// ============================================================================

const apiClient = new RyanAIClient(API_BASE_URL, APP_VERSION);

// Attach to window for global access with complete TypeScript declarations
declare global {
  interface Window {
    ryanai: {
      client: RyanAIClient;
      version: string;
      environment: string;
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
  environment: APP_ENV,
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
// HEALTH CHECK BEFORE INITIALIZATION
// ============================================================================

const performHealthCheck = async (): Promise<boolean> => {
  try {
    await apiClient.healthCheck();
    console.log('✅ Backend health check passed');
    return true;
  } catch (error) {
    console.warn('⚠️ Backend health check failed (will retry):', error);
    return false;
  }
};

// ============================================================================
// INITIALIZE REACT APPLICATION
// ============================================================================

const initializeApp = async () => {
  try {
    initializeSentry();

    const backendHealthy = await performHealthCheck();
    if (backendHealthy) {
      console.log('🟢 Backend connection established');
    } else {
      console.log('🟡 Backend unavailable - frontend operating in offline mode');
    }

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
    console.log(
      `%c📍 API: ${API_BASE_URL}`,
      'color: #00f3ff; font-family: monospace; font-size: 12px;'
    );

    window.dispatchEvent(
      new CustomEvent('ryanai-ready', {
        detail: {
          version: APP_VERSION,
          environment: APP_ENV,
          backendHealthy,
          timestamp: new Date().toISOString(),
        },
      })
    );
  } catch (error) {
    console.error('❌ Failed to initialize RyanAI Command Center:', error);

    const errorBoundary = document.getElementById('error-boundary');
    const loadingScreen = document.getElementById('loading-screen');

    if (errorBoundary && loadingScreen) {
      loadingScreen.style.display = 'none';
      errorBoundary.style.display = 'block';
      const errorDetails = document.getElementById('error-details');
      if (errorDetails) {
        errorDetails.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    window.dispatchEvent(
      new CustomEvent('ryanai-error', {
        detail: {
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        },
      })
    );

    throw error;
  }
};

// ============================================================================
// START APPLICATION
// ============================================================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp().catch(console.error);
}

// ============================================================================
// HOT MODULE REPLACEMENT (HMR) FOR DEVELOPMENT
// ============================================================================

if (import.meta.hot) {
  import.meta.hot.accept('./App', () => {
    console.log('🔄 Hot module replacement triggered');
  });
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
    'color: #00f3ff; font-size: 12px; font-family: monospace;'
  );
}
