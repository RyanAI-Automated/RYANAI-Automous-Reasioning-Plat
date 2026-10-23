import { create } from "zustand";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

export interface AgentState {
  sessionId: string;
  messages: Message[];
  isProcessing: boolean;
  activeTool: string | null;
  setSessionId: (sessionId: string) => void;
  addMessage: (message: Message) => void;
  setProcessing: (isProcessing: boolean) => void;
  setActiveTool: (activeTool: string | null) => void;
  clearSession: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  sessionId: crypto.randomUUID ? crypto.randomUUID() : "default-session",
  messages: [],
  isProcessing: false,
  activeTool: null,
  setSessionId: (sessionId) => set({ sessionId }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setProcessing: (isProcessing) => set({ isProcessing }),
  setActiveTool: (activeTool) => set({ activeTool }),
  clearSession: () => set({ messages: [], sessionId: crypto.randomUUID ? crypto.randomUUID() : "default-session" }),
}));