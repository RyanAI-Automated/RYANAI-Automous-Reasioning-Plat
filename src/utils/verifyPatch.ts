import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, realpath, rm, writeFile, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DOCKER = "/usr/bin/docker";
const DAEMON = "unix:///var/run/docker.sock";
const IMAGE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/:-]*@sha256:[a-f0-9]{64}\$/;

const VERIFY = `
cp -R /input/. /work/
cmp /work/package-lock.json /opt/patch-deps/package-lock.json
node -e 'const fs = require("fs"); const candidate = JSON.parse(fs.readFileSync("/work/package.json")); const trusted = JSON.parse(fs.readFileSync("/opt/patch-deps/package.json")); for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides"]) { if (JSON.stringify(candidate[field]) !== JSON.stringify(trusted[field])) process.exit(1); }'
cp -R /opt/patch-deps/node_modules /work/node_modules
cd /work
npm run validate
if [ -f /verification-script.js ]; then node /verification-script.js; fi
`;

export type VerificationPipelineResult = { success: boolean; error?: string };

export interface PatchVerificationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

/**
 * Securely verifies a staged patch file in isolation before applying it 
 * to the live workspace. Prevents live corruption and unvalidated code exposure.
 */
export async function verifyStagedPatch(
  stagedFilePath: string,
  targetRelativePath: string
): Promise<PatchVerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const fileStats = await stat(stagedFilePath);
    if (!fileStats.isFile()) {
      errors.push('Staged patch path is not a valid file.');
      return { isValid: false, errors, warnings };
    }

    const content = await readFile(stagedFilePath, 'utf-8');

    if (
      content.includes('<<<<<<<') ||
      content.includes('=======') ||
      content.includes('>>>>>>>')
    ) {
      errors.push('Security Check Failed: Patch contains unresolved Git merge conflict markers.');
    }

    if (content.includes('eval(') || content.includes('child_process.execSync')) {
      warnings.push('Warning: Patch introduces high-risk execution primitives (eval/execSync). Review recommended.');
    }

    if (targetRelativePath.endsWith('.ts') || targetRelativePath.endsWith('.tsx')) {
      try {
        await execFileAsync('npx', ['tsc', '--noEmit', '--skipLibCheck', stagedFilePath], {
          timeout: 15000,
        });
      } catch (execError: any) {
        errors.push(`TypeScript validation failed: ${execError.stderr?.trim() || execError.message}`);
      }
    }
  } catch (err: any) {
    errors.push(`Verification subsystem error: ${err.message}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate an immutable staging tree, never the live workspace.
 */
export async function runVerificationPipeline(
  cwd: string,
  testScript?: string,
): Promise<VerificationPipelineResult> {
  const image = process.env.RYAN_PATCH_VERIFIER_IMAGE;
  if (!image || !IMAGE_PATTERN.test(image)) {
    return {
      success: false,
      error: "A digest-pinned RYAN_PATCH_VERIFIER_IMAGE is required.",
    };
  }

  let configDirectory: string | undefined;
  let containerAttempted = false;
  let result: VerificationPipelineResult = {
    success: false,
    error: "Isolated patch validation failed.",
  };
  const name = `ryan-patch-${randomUUID()}`;

  try {
    const staging = await realpath(cwd);
    if (/[\r\n,]/.test(staging)) throw new Error("Unsupported staging path");
    configDirectory = await mkdtemp(join(tmpdir(), "ryan-patch-verifier-"));
    const env = {
      PATH: "/usr/bin:/bin",
      HOME: configDirectory,
      DOCKER_CONFIG: configDirectory,
    };
    const docker = (args: string[], timeout: number) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          DOCKER,
          ["--host", DAEMON, ...args],
          {
            env,
            cwd: "/",
            timeout,
            killSignal: "SIGKILL",
            maxBuffer: 1024 * 1024,
          },
          (error, stdout) => (error ? reject(error) : resolve(stdout)),
        );
      });

    const mounts = ["--mount", `type=bind,src=${staging},dst=/input,readonly`];
    if (testScript !== undefined) {
      const script = join(configDirectory, "verification-script.js");
      if (/[\r\n,]/.test(script)) throw new Error("Unsupported script path");
      await writeFile(script, testScript, { mode: 0o644 });
      await chmod(script, 0o644);
      mounts.push(
        "--mount",
        `type=bind,src=${script},dst=/verification-script.js,readonly`,
      );
    }

    try {
      containerAttempted = true;
      await docker(
        [
          "create",
          "--name",
          name,
          "--pull=never",
          "--network=none",
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--user=65534:65534",
          "--pids-limit=256",
          "--memory=4g",
          "--memory-swap=4g",
          "--cpus=2",
          "--ipc=none",
          "--log-driver=none",
          "--init",
          "--tmpfs",
          "/work:rw,nosuid,nodev,size=2g,mode=1777",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,noexec,size=256m,mode=1777",
          "--env",
          "HOME=/tmp",
          "--workdir",
          "/work",
          ...mounts,
          "--entrypoint",
          "/bin/sh",
          image,
          "-eu",
          "-c",
          VERIFY,
        ],
        30_000,
      );
      await docker(["start", "--attach", name], 300_000);
      const state = await docker(
        ["inspect", "--format", "{{.State.Status}} {{.State.ExitCode}}", name],
        30_000,
      );
      if (state.trim() !== "exited 0")
        throw new Error("Verification did not exit successfully");
      result = { success: true };
    } finally {
      if (containerAttempted) {
        try {
          await docker(["rm", "--force", name], 30_000);
        } catch {
          result = {
            success: false,
            error: "Patch verifier cleanup failed; promotion refused.",
          };
        }
      }
    }
  } catch {
    if (result.success)
      result = { success: false, error: "Isolated patch validation failed." };
  } finally {
    if (configDirectory) {
      try {
        await rm(configDirectory, { recursive: true, force: true });
      } catch {
        result = {
          success: false,
          error: "Patch verifier cleanup failed; promotion refused.",
        };
      }
    }
  }
  return result;
}