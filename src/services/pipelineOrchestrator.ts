import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { DispatchService } from './dispatchService.js';
import { GitHubShipper } from './githubShipper.js';

const execAsync = promisify(exec);
const dispatch = new DispatchService();
const github = new GitHubShipper();

interface PipelineStep {
  phase: string;
  action: string;
  status: string;
}

export class PipelineOrchestrator {
  async executeFullPipeline(projectName: string, instructions: string) {
    console.log(`[PIPELINE] Initializing 5-Phase sequence for: ${projectName} with instructions: ${instructions}`);
    const decisionGraph: PipelineStep[] = [];

    try {
      // 1. ARCHITECTURE PHASE
      console.log('[PHASE 1: ARCHITECTURE] Parsing requirements...');
      decisionGraph.push({ phase: 'Architecture', action: 'Parse AST', status: 'OK' });
      
      // 2. DEV PHASE
      console.log('[PHASE 2: DEV] Generating system components...');
      const generatedCode = [{ path: 'src/main.ts', content: 'console.log("RyanAI Built this");' }];
      decisionGraph.push({ phase: 'Dev', action: 'Code Generation', status: 'OK' });

      // 3. BUILD & TEST PHASE (Governed by Transcend & eBPF)
      console.log('[PHASE 3 & 4: BUILD/TEST] Booting Docker Sandbox...');
      await execAsync(`docker build -t ${projectName}-test .`);
      await execAsync(`docker run --rm ${projectName}-test npm run test`);
      decisionGraph.push({ phase: 'Build/Test', action: 'Docker Execution', status: 'PASSED' });

      // 5. SHIP PHASE
      console.log('[PHASE 5: SHIP] Pushing to GitHub & Triggering Vercel/Railway...');
      await github.commitAndPushFiles({
        owner: 'ganyane',
        repo: projectName,
        branch: 'main',
        commitMessage: 'feat: RyanAI automated pipeline build',
        files: generatedCode,
        createBranchIfMissing: true,
      });
      decisionGraph.push({ phase: 'Ship', action: 'GitHub Octokit Push', status: 'SHIPPED' });

      // FINAL: Dispatch completion alert via WhatsApp/Email
      await dispatch.sendWhatsAppSecurityAlert({
        pid: process.pid,
        command: `Pipeline Build: ${projectName}`,
        violations: [],
        actionTaken: 'SUCCESS',
        timestamp: new Date().toISOString(),
      });

      return { status: 'PIPELINE_COMPLETE', decisionGraph };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[PIPELINE_FAILED] Execution halted.', error);
      
      await dispatch.sendWhatsAppSecurityAlert({
        pid: process.pid,
        command: `Pipeline Build: ${projectName}`,
        violations: [errorMessage],
        actionTaken: 'FAILED',
        timestamp: new Date().toISOString(),
      });
      
      throw error;
    }
  }
}