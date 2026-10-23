// src/engine/workspaceScanner.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { RyanAIAgentWorkers, AgentTaskResult } from './agentWorkers';

export interface WorkspaceAuditReport {
  scannedFilesCount: number;
  securityAudit: AgentTaskResult;
  performanceAudit: AgentTaskResult;
  timestamp: string;
}

export class RyanWorkspaceScanner {
  private static WORKSPACE_ROOT = process.cwd();

  /**
   * Scan direct .ts and .js files in the requested workspace directories and audit them.
   * Read failures skip the rest of that directory; worker failures propagate.
   * Return the number of files read, both audit results, and an ISO timestamp.
   */
  static async runFullWorkspaceScan(targetDirs: string[] = ['src/engine', 'src/mcp']): Promise<WorkspaceAuditReport> {
    console.log("[Objective 1] Initializing static workspace scan...");

    let aggregatedCodebase = "";
    let fileCount = 0;

    for (const dir of targetDirs) {
      const fullDirPath = path.resolve(this.WORKSPACE_ROOT, dir);
      try {
        const entries = await fs.readdir(fullDirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
            const filePath = path.join(fullDirPath, entry.name);
            const content = await fs.readFile(filePath, 'utf-8');
            aggregatedCodebase += `\n--- File: ${dir}/${entry.name} ---\n${content}\n`;
            fileCount++;
          }
        }
      } catch (err: unknown) {
        console.warn(`[Workspace Scanner] Could not read directory ${dir}: ${(err instanceof Error ? err.message : String(err))}`);
      }
    }

    console.log(`[Objective 1] Scanned ${fileCount} files. Dispatching to Security Sentinel & Performance Profiler agents...`);

    // Run specialized agents concurrently on the aggregated source code
    const [securityResult, performanceResult] = await Promise.all([
      RyanAIAgentWorkers.runSecurityAuditor(aggregatedCodebase),
      RyanAIAgentWorkers.runPerformanceProfiler(aggregatedCodebase)
    ]);

    console.log("[Objective 1] Static workspace scan and multi-agent audit completed successfully.");

    return {
      scannedFilesCount: fileCount,
      securityAudit: securityResult,
      performanceAudit: performanceResult,
      timestamp: new Date().toISOString()
    };
  }
}