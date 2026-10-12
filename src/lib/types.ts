// src/lib/types.ts
// Complete TypeScript type definitions for RyanAI

import modelCatalog from '../../models/catalog.json';

export type ModelId = (typeof modelCatalog.models)[number]['id'];

export interface SystemStatus {
  cpu: number | null; // Allow null
  // ... other properties
}

export interface AIModelConfig {
  provider: 'openai' | 'anthropic' | 'local';
  modelName: string;
  temperature: number;
  maxTokens?: number;
}

export interface SystemStatus {
  cpu: number | null;        // Allowed to be null when metrics aren't reporting
  memory?: number | null;    // Allowed to be null
  disk?: number | null;      // Allowed to be null
  status: 'healthy' | 'degraded' | 'offline';
  uptime?: number;
  activeAgents?: number;
  [key: string]: any;        // Fallback for any extra dynamic telemetry fields
}

export interface ModelMeta {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: ModelId;
  steps?: ToolStep[];
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: ModelId;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface ToolStep {
  type: string;
  name: string;
  result?: string;
  args?: Record<string, unknown>;
}

export interface SystemStatus {
  cpu: number | null;
  memory: number | null;
  latency: number | null;
  tokensIn: number;
  tokensOut: number;
  uptime: string;
  model: ModelId;
  state: 'idle' | 'thinking' | 'error';
}

export interface MemoryEntry {
  id: string;
  content: string;
  timestamp: number;
  type: 'note' | 'thought' | 'insight';
}

export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface StreamingResponse {
  status: 'processing' | 'complete' | 'error';
  message?: string;
  result?: string;
  error?: string;
}

export interface ReasoningRequest {
  prompt: string;
  sessionId?: string;
  model?: ModelId;
}

export interface ReasoningCallbacks {
  onToken?: (token: string) => void;
  onStep?: (step: ToolStep) => void;
  onTitle?: (title: string) => void;
  onDone?: () => void;
  onError?: (error: string) => void;
}