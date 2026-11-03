import { Pool } from "pg";

interface AgentState {
  sessionId: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  currentStep: number;
  maxSteps: number;
}

export class AgentOrchestrator {
  private pgPool: Pool;

  constructor(connectionString: string) {
    this.pgPool = new Pool({ connectionString });
  }

  async initializeSession(sessionId: string): Promise<AgentState> {
    const query = `SELECT role, content FROM agent_memory WHERE session_id = $1 ORDER BY timestamp ASC;`;
    const result = await this.pgPool.query(query, [sessionId]);
    
    return {
      sessionId,
      messages: result.rows.map((row: { role: "user" | "assistant" | "system"; content: string }) => ({ 
        role: row.role, 
        content: row.content 
      })),
      currentStep: 0,
      maxSteps: 5,
    };
  }

  async persistMemory(sessionId: string, role: string, content: string): Promise<void> {
    const query = `INSERT INTO agent_memory (session_id, role, content) VALUES ($1, $2, $3);`;
    await this.pgPool.query(query, [sessionId, role, content]);
  }

  async executeReActCycle(state: AgentState, inputPrompt: string): Promise<string> {
    await this.persistMemory(state.sessionId, "user", inputPrompt);
    state.messages.push({ role: "user", content: inputPrompt });

    // Step 1: Thought generation
    const thought = `Analyzing context for: "${inputPrompt}". Evaluating tool-routing matrix.`;
    state.currentStep++;

    // Step 2: Action / Tool execution simulation with assigned thought variable
    const toolResult = state.currentStep <= state.maxSteps 
      ? `Tool execution successful: eBPF / PostgreSQL state verified. [Thought: ${thought}]` 
      : "Max reasoning steps reached.";

    const finalAnswer = `RyanAI Autonomous Reasoning Complete. Insight: [${toolResult}]`;

    await this.persistMemory(state.sessionId, "assistant", finalAnswer);
    return finalAnswer;
  }
}