import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

export interface CsExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
}

export class CsScriptTool {
  /**
   * Validate C# script syntax using global cs-syntaxer.
   */
  public static async validateSyntax(scriptContent: string): Promise<CsExecutionResult> {
    const tempFile = join(tmpdir(), `script-${randomUUID()}.cs`);
    try {
      await writeFile(tempFile, scriptContent, "utf-8");
      const { stdout, stderr } = await execFileAsync("syntaxer", [tempFile], { timeout: 10000 });
      return { success: true, output: stdout || stderr };
    } catch (err: unknown) {
      const executionError = err as { stderr?: string; message?: string };
      return {
        success: false,
        error: executionError.stderr?.trim() || executionError.message || String(err),
      };
    } finally {
      await unlink(tempFile).catch(() => {});
    }
  }

  /**
   * Execute C# script dynamically using global cs-script engine (css).
   */
  public static async executeScript(scriptContent: string, args: string[] = []): Promise<CsExecutionResult> {
    const tempFile = join(tmpdir(), `script-${randomUUID()}.cs`);
    try {
      await writeFile(tempFile, scriptContent, "utf-8");
      const { stdout, stderr } = await execFileAsync("css", [tempFile, ...args], { timeout: 30000 });
      return { success: true, output: stdout, error: stderr };
    } catch (err: unknown) {
      const executionError = err as {
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      return {
        success: false,
        output: executionError.stdout,
        error: executionError.stderr?.trim() || executionError.message || String(err),
      };
    } finally {
      await unlink(tempFile).catch(() => {});
    }
  }
}
