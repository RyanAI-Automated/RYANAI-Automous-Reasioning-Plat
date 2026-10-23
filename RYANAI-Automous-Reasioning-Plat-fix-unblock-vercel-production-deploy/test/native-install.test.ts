import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const binding = JSON.parse(
  readFileSync(path.join(root, "binding.gyp"), "utf8"),
);
const target = binding.targets[0];

/** Executes a checked-in GYP shell substitution with an isolated CUDA_PATH value. */
function evaluateSubstitution(expression: string, cudaPath?: string): string {
  const command = expression.match(/^<!@?\((.*)\)$/)?.[1];
  expect(command, "expected a GYP shell substitution").toBeDefined();
  const env = { ...process.env };
  delete env.CUDA_PATH;
  if (cudaPath !== undefined) env.CUDA_PATH = cudaPath;
  const result = spawnSync(command!, {
    cwd: root,
    env,
    shell: true,
    encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

describe("optional native addon installation", () => {
  it("installs without compiling the root addon when lifecycle scripts are enabled", () => {
    const fixture = mkdtempSync(path.join(tmpdir(), "ryan-native-install-"));
    try {
      const manifest = JSON.parse(
        readFileSync(path.join(root, "package.json"), "utf8"),
      );
      for (const field of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
        "overrides",
      ]) {
        delete manifest[field];
      }
      writeFileSync(
        path.join(fixture, "package.json"),
        JSON.stringify(manifest),
      );
      copyFileSync(
        path.join(root, "binding.gyp"),
        path.join(fixture, "binding.gyp"),
      );
      const result = spawnSync(
        "npm",
        [
          "install",
          "--ignore-scripts=false",
          "--offline",
          "--no-audit",
          "--no-fund",
          "--package-lock=false",
        ],
        {
          cwd: fixture,
          encoding: "utf8",
          shell: process.platform === "win32",
          timeout: 20_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout + result.stderr).not.toContain("node-gyp");
      expect(existsSync(path.join(fixture, "build"))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);

  it("resolves node-addon-api headers and GYP dependency through the shell", () => {
    const includePath = JSON.parse(
      evaluateSubstitution(target.include_dirs[0]),
    );
    expect(existsSync(path.join(includePath, "napi.h"))).toBe(true);
    const dependency = evaluateSubstitution(target.dependencies[0]);
    expect(dependency).toMatch(/:nothing$/);
    const gypPath = dependency.replace(/:nothing$/, "");
    expect(existsSync(path.resolve(root, gypPath))).toBe(true);
    expect(path.basename(gypPath)).toBe("node_api.gyp");
  });

  it.each([
    [undefined, "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.0"],
    [String.raw`D:\GPU Toolkits\CUDA\v13.0`, "D:/GPU Toolkits/CUDA/v13.0"],
  ])(
    "resolves Windows CUDA paths with CUDA_PATH=%s",
    (cudaPath, expectedBase) => {
      const windows = target.conditions.find(
        ([condition]: [string]) => condition === "OS=='win'",
      )[1];
      expect(evaluateSubstitution(windows.include_dirs[0], cudaPath)).toBe(
        `${expectedBase}/include`,
      );
      expect(evaluateSubstitution(windows.libraries[0], cudaPath)).toBe(
        `${expectedBase}/lib/x64/cudart.lib`,
      );
    },
  );
});
