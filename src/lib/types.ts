import modelCatalog from '../../models/catalog.json' assert { type: 'json' };

export type ModelId = (typeof modelCatalog.models)[number]['id'];

export interface SystemStatus {
  cpu: number | null;
  memory: number | null;
  disk?: number | null;
  latency: number | null;
  tokensIn: number;
  tokensOut: number;
  uptime: number | string;
  model: ModelId;
  state: 'idle' | 'thinking' | 'error';
  status?: 'healthy' | 'degraded' | 'offline';
  activeAgents?: number;
  [key: string]: unknown;
}

export interface AIModelConfig { 
  provider: 'openai' | 'anthropic' | 'local'; 
  modelName: string; 
  temperature: number; 
  maxTokens?: number; 
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