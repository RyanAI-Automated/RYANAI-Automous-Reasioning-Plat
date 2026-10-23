// File path: ./src/agent/nodes.ts

import { ToolNode } from "@langchain/langgraph/prebuilt";
import { DynamicTool } from "@langchain/core/tools";
import { totalmem, freemem } from "node:os";
import { db } from "../database/db.js";

const systemStatusTool = new DynamicTool({
  name: "query_system_state",
  description: "Returns real host process and memory telemetry. CUDA is reported as configured only when CUDA_ENABLED=true.",
  func: async () => {
    const memoryTotalBytes = totalmem();
    const memoryFreeBytes = freemem();
    return JSON.stringify({
      architecture: process.arch,
      platform: process.platform,
      processMemoryBytes: process.memoryUsage(),
      hostMemoryBytes: { total: memoryTotalBytes, free: memoryFreeBytes, used: memoryTotalBytes - memoryFreeBytes },
      cudaConfigured: process.env.CUDA_ENABLED === "true",
      uptimeSeconds: process.uptime(),
    });
  },
});

const databaseQueryTool = new DynamicTool({
  name: "query_agent_memory",
  description: "Searches recent RyanAI agent-memory records in the configured database.",
  func: async (query: string) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("A non-empty memory search query is required.");
    const records = await db.agentMessage.findMany({
      where: { content: { contains: normalizedQuery } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { sessionId: true, role: true, content: true, reasoningSteps: true, createdAt: true },
    });
    return JSON.stringify({ query: normalizedQuery, count: records.length, records });
  },
});

export const ryanAgentTools = [systemStatusTool, databaseQueryTool];
export const ryanToolNode = new ToolNode(ryanAgentTools);