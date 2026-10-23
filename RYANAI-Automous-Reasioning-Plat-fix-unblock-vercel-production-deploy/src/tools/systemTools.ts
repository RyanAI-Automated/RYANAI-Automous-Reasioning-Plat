// src/tools/systemTools.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Return GPU diagnostics, a fresh Node process's memory usage, or a general status.
 * Caught command failures become diagnostic failure messages.
 */
export const systemDiagnosticsTool = tool(
  async ({ queryType }) => {
    try {
      if (queryType === "memory") {
        const { stdout } = await execAsync("node -e \"console.log(process.memoryUsage())\"");
        return `Memory Diagnostics:\n${stdout}`;
      } else if (queryType === "gpu") {
        // Queries nvidia-smi if available
        const { stdout } = await execAsync("nvidia-smi --query-gpu=memory.used,memory.free,utilization.gpu --format=csv,noheader");
        return `Nvidia GPU Telemetry:\n${stdout}`;
      }
      return "General system nominal.";
    } catch (error: unknown) {
      return `Diagnostics failed: ${(error instanceof Error ? error.message : String(error))}`;
    }
  },
  {
    name: "system_diagnostics",
    description: "Inspects local system or GPU telemetry for debugging reasoning latency.",
    schema: z.object({
      queryType: z.enum(["memory", "gpu", "general"]).describe("The category of system telemetry to fetch."),
    }),
  }
);

export const ryanAiTools = [systemDiagnosticsTool];