// File path: ./src/hooks/useRyanEngine.ts

import { useState, useCallback } from "react";
import { executeAgentReasoning, fetchSystemHealth, SystemHealth } from "../services/api";

export type EngineState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'ERROR';

export interface EngineEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoningSteps?: string[];
  timestamp: string;
}

export function useRyanEngine() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "RyanAI Autonomous Reasoning Engine initialized. Fastify gateway connection active.",
      reasoningSteps: [
        "Mounted root platform container template.",
        "Initialized Fastify API gateway & LangGraph ReAct workflow.",
        "Verified CUDA driver acceleration & memory allocation."
      ],
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [engineState, setEngineState] = useState<EngineState>('IDLE');
  const [events, setEvents] = useState<EngineEvent[]>([]);

  const logEvent = useCallback((type: string, payload: Record<string, unknown>) => {
    setEvents((prev) => [...prev, { type, payload }]);
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const data = await fetchSystemHealth();
      setHealth(data);
      logEvent('HEALTH_CHECK_SUCCESS', { status: data.status });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("Backend health check warning:", errorMessage);
      logEvent('HEALTH_CHECK_ERROR', { error: errorMessage });
    }
  }, [logEvent]);

  const sendMessage = useCallback(async (prompt: string) => {
    if (!prompt.trim() || isProcessing) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsProcessing(true);
    setEngineState('RUNNING');
    logEvent('REASONING_START', { promptLength: prompt.length });

    try {
      const result = await executeAgentReasoning(prompt);
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: result.output,
        reasoningSteps: result.reasoningTrace,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setEngineState('IDLE');
      logEvent('REASONING_COMPLETE', { stepsCount: result.reasoningTrace?.length ?? 0 });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown gateway error";
      const errorMsgObj: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Error executing reasoning pipeline: ${errorMessage}. Check the API service and provider configuration.`,
        reasoningSteps: ["API or model provider request failed"],
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorMsgObj]);
      setEngineState('ERROR');
      logEvent('REASONING_ERROR', { error: errorMessage });
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, logEvent]);

  return {
    messages,
    isProcessing,
    health,
    engineState,
    events,
    sendMessage,
    checkHealth,
  };
}