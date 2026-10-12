import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);
const SANDBOX_DIR = path.resolve(process.cwd(), 'sandbox-runtime');

export interface SandboxResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  output?: string;
  error?: string;
}

export class RyanAISandbox {
  /**
   * Write a script and run it with host Node using sandbox-runtime as the working directory.
   * The file remains on disk. Execution has a 10-second timeout and returns trimmed
   * output; process failures become an unsuccessful result. Directory creation and
   * file-write errors propagate before execution.
   *
   * @param fileName - Script path joined to sandbox-runtime; passed to a shell command.
   */
  public static async executeInSandbox(
    scriptContent: string,
    fileName = 'agent_payload.js'
  ): Promise<SandboxResult> {
    await fs.mkdir(SANDBOX_DIR, { recursive: true });
    const filePath = path.join(SANDBOX_DIR, fileName);
    await fs.writeFile(filePath, scriptContent, 'utf-8');

    console.log(`[Sandbox] Deploying code payload to isolated runtime: ${fileName}`);

    try {
      // Execute with a strict 10-second timeout and isolated working directory
      const { stdout, stderr } = await execAsync(`node ${filePath}`, {
        timeout: 10000,
        cwd: SANDBOX_DIR,
      });

      const trimmedStdout = stdout.trim();
      const trimmedStderr = stderr.trim();

      return {
        stdout: trimmedStdout,
        stderr: trimmedStderr,
        exitCode: 0,
        success: true,
        output: trimmedStdout,
        error: trimmedStderr ? trimmedStderr : undefined,
      };
    } catch (error: unknown) {
      const failure = error as { stdout?: string; stderr?: string; code?: number | string };
      const stdout = failure.stdout?.trim() || '';
      const stderr = failure.stderr?.trim() || (error instanceof Error ? error.message : String(error));

      return {
        stdout,
        stderr,
        exitCode: typeof failure.code === 'number' ? failure.code : 1,
        success: false,
        output: stdout,
        error: stderr,
      };
    }
  }
}