// src/engine/telemetryDaemon.ts
import { systemDiagnosticsTool } from "../tools/systemTools.js";
import { ryanAgentApp } from "./agentGraph.js";
import { HumanMessage } from "@langchain/core/messages";

export class TelemetryDaemon {
  private intervalId: NodeJS.Timeout | null = null;
  private checkIntervalMs: number;

  constructor(intervalMs: number = 60000) {
    this.checkIntervalMs = intervalMs;
  }

  public start() {
    if (this.intervalId) return;

    console.log("[Telemetry Daemon] Autonomous health-monitoring watchdog started.");

    this.intervalId = setInterval(async () => {
      try {
        const diagnosticsRaw = await systemDiagnosticsTool.invoke({ queryType: "general" });
        const diagnostics = typeof diagnosticsRaw === "string" ? JSON.parse(diagnosticsRaw) : diagnosticsRaw;

        // Example trigger condition: High memory pressure or error spike
        if (diagnostics?.memoryPressure || diagnostics?.hasUnresolvedErrors) {
          console.warn("[Telemetry Daemon] Anomaly detected! Triggering autonomous self-healing agent loop...");

          await ryanAgentApp.invoke({
            messages: [
              new HumanMessage(
                `System telemetry reported an anomaly: ${JSON.stringify(diagnostics)}. Diagnose and apply necessary patches using available tools.`
              ),
            ],
          });
        }
      } catch (error) {
        console.error("[Telemetry Daemon Error]:", error);
      }
    }, this.checkIntervalMs) as unknown as NodeJS.Timeout;
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[Telemetry Daemon] Watchdog stopped.");
    }
  }
}