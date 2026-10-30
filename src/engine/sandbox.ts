import { runVerificationPipeline } from '../utils/verifyPatch.js';

export interface SandboxResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  output?: string;
  error?: string;
}

/**
 * Verify generated code only inside the same digest-pinned, network-disabled
 * container used by workspace patch promotion. Never execute model output on
 * the API host. The filename argument remains for call compatibility only.
 */
export class RyanAISandbox {
  public static async executeInSandbox(
    scriptContent: string,
    _fileName = 'agent_payload.js',
  ): Promise<SandboxResult> {
    if (typeof scriptContent !== 'string' || Buffer.byteLength(scriptContent) > 200_000) {
      const error = 'Generated verification script must be a string no larger than 200 KB.';
      return { success: false, stdout: '', stderr: error, exitCode: 1, error };
    }
    const verification = await runVerificationPipeline(process.cwd(), scriptContent);
    if (!verification.success) {
      const error = verification.error || 'Isolated code verification failed.';
      return { success: false, stdout: '', stderr: error, exitCode: 1, error };
    }
    return {
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
      output: 'Code completed the digest-pinned, network-disabled verification pipeline.',
    };
  }
}
