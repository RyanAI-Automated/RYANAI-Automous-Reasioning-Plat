// src/engine/agentWorkers.ts
import { secondaryBrain, logicBrain } from '../config/brains';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export interface AgentTaskResult {
  agentName: string;
  output: string;
}

export class RyanAIAgentWorkers {
  /**
   * Security Sentinel Agent: Audits codebases, configuration files, and scripts for security vulnerabilities and injection risks.
   */
  static async runSecurityAuditor(targetCode: string): Promise<AgentTaskResult> {
    console.log("[Security Agent] Initializing static analysis and threat scan...");
    
    const response = await secondaryBrain.invoke([
      new SystemMessage(
        "You are the Security Sentinel and Threat Analysis Agent for RyanAI. " +
        "Rigorously inspect the target code for security vulnerabilities, path traversal risks, " +
        "unvalidated inputs, and authentication flaws. Provide a clear, actionable remediation report."
      ),
      new HumanMessage(`Target Code / Specification:\n${targetCode}`)
    ]);

    return {
      agentName: "SecuritySentinel",
      output: response.content.toString()
    };
  }

  /**
   * Performance Profiler Agent: Analyzes code structure for latency bottlenecks, memory leaks, and CUDA/CPU optimization opportunities.
   */
  static async runPerformanceProfiler(targetCode: string): Promise<AgentTaskResult> {
    console.log("[Profiler Agent] Evaluating execution bottlenecks and tensor throughput...");

    const response = await logicBrain.invoke([
      new SystemMessage(
        "You are the Performance Profiler and Optimization Agent for RyanAI. " +
        "Analyze the provided code or architecture for algorithmic complexity, asynchronous blocking, " +
        "and resource utilization. Recommend specific performance enhancements."
      ),
      new HumanMessage(`Target Code / Architecture:\n${targetCode}`)
    ]);

    return {
      agentName: "PerformanceProfiler",
      output: response.content.toString()
    };
  }
}