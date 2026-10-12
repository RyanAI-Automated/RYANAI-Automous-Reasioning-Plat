// src/shared/types.ts - Unified type definitions across app
export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'staging';
  port: number;
  host: string;
  database: {
    url: string;
    maxConnections: number;
    timeoutMs: number;
  };
  redis: {
    url: string;
    timeout: number;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  api: {
    baseUrl: string;
    timeout: number;
  };
  mcp: {
    enabled: boolean;
    serverPort: number;
  };
  openai: {
    apiKey: string;
    model: string;
  };
  sentry: {
    enabled: boolean;
    dsn: string;
  };
  tauri: {
    enabled: boolean;
    allowedOrigins: string[];
  };
}

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  roles: string[];
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface APIRequest<T = unknown> {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  body?: T;
  headers?: Record<string, string>;
  auth?: AuthContext;
  timestamp: number;
}

export interface APIResponse<T = unknown> {
  id: string;
  status: number;
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  timestamp: number;
  duration: number;
}

export interface WebSocketMessage<T = unknown> {
  id: string;
  type: 'request' | 'response' | 'event' | 'stream' | 'error';
  channel: string;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  timestamp: number;
}

export interface ReasoningRequest {
  prompt: string;
  sessionId: string;
  context?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

export interface ReasoningResponse {
  result: string;
  reasoning: string[];
  confidence: number;
  toolCalls: ToolCall[];
  sessionId: string;
  duration: number;
}

export interface ToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export interface AgentState {
  sessionId: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  }>;
  context: Record<string, unknown>;
  status: 'idle' | 'processing' | 'paused' | 'completed' | 'error';
  lastUpdate: number;
}

export interface StreamEvent<T = unknown> {
  type: 'start' | 'chunk' | 'progress' | 'complete' | 'error';
  data?: T;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export class AppError extends Error {
  /** Create an application error with an HTTP status (default 500) and optional details. */
  constructor(
    public code: string,
    public message: string,
    public status: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  /** Create a VALIDATION_ERROR with HTTP status 400 and optional details. */
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class AuthError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super('AUTH_ERROR', message, 401);
    this.name = 'AuthError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}
