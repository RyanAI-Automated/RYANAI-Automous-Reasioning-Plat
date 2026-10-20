import { execFile, fork, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyWorkspacePatch,
  recoverWorkspacePatch,
} from "./workspacePatch.js";

const execFileAsync = promisify(execFile);
const directories: string[] = [];
const workspaces: string[] = [];
const children = new Map<ChildProcess, Promise<void>>();
const request = { filePath: "src/app.ts", patchContent: "verified candidate" };
type StopPhase = "verification" | "before-rename" | "after-rename";

async function stop(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      children.get(child),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Child did not exit")),
          5_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

afterEach(async () => {
  await Promise.all([...children.keys()].map(stop));
  children.clear();
  // Recovery also removes staging directories created outside the workspace.
  for (const root of workspaces.splice(0)) {
    await recoverWorkspacePatch(root, true);
  }
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "patch-crash-test-"));
  directories.push(directory);
  const root = path.join(directory, "workspace");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  workspaces.push(root);
  await fs.writeFile(path.join(root, request.filePath), "original");
  await fs.writeFile(path.join(root, "package.json"), "{}");
  for (const args of [
    ["init", "-q"],
    ["add", "."],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-qm",
      "fixture",
    ],
  ]) {
    await execFileAsync("/usr/bin/git", ["-C", root, ...args]);
  }

  // Compile the production implementation unchanged except for its two I/O seams.
  // The child uses real filesystem operations; only validation and rename pauses
  // are injected, so SIGKILL actually interrupts the transaction's normal control flow.
  const source = await fs.readFile(
    new URL("./workspacePatch.ts", import.meta.url),
    "utf8",
  );
  const compiled = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 },
  }).outputText;
  expect(compiled).toContain('from "node:fs/promises"');
  expect(compiled).toContain('from "./verifyPatch.js"');
  await fs.writeFile(
    path.join(directory, "workspacePatch.mjs"),
    compiled
      .replace('from "node:fs/promises"', 'from "./filesystem.mjs"')
      .replace('from "./verifyPatch.js"', 'from "./verifier.mjs"'),
  );
  await fs.writeFile(
    path.join(directory, "control.mjs"),
    `
export let stage;
export function setStage(value) { stage = value; }
export async function pause(phase) {
  if (process.argv[3] !== phase) return;
  process.send({ phase, stage });
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
`,
  );
  await fs.writeFile(
    path.join(directory, "verifier.mjs"),
    `
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { pause, setStage } from "./control.mjs";
export async function runVerificationPipeline(stage) {
  assert.equal(await readFile(join(stage, "src/app.ts"), "utf8"), "verified candidate");
  assert.equal(await readFile(join(process.argv[2], "src/app.ts"), "utf8"), "original");
  setStage(stage);
  await pause("verification");
  return { success: true };
}
`,
  );
  await fs.writeFile(
    path.join(directory, "filesystem.mjs"),
    `
export * from "node:fs/promises";
import { rename as actualRename } from "node:fs/promises";
import { join } from "node:path";
import { pause } from "./control.mjs";
export async function rename(from, to) {
  const promotion = to === join(process.argv[2], "src/app.ts");
  if (promotion) await pause("before-rename");
  await actualRename(from, to);
  if (promotion) await pause("after-rename");
}
`,
  );
  await fs.writeFile(
    path.join(directory, "child.mjs"),
    `
import { applyWorkspacePatch } from "./workspacePatch.mjs";
const result = await applyWorkspacePatch(process.argv[2], ${JSON.stringify(request)});
throw new Error("Transaction unexpectedly completed: " + JSON.stringify(result));
`,
  );
  return { directory, root };
}

async function interrupt(directory: string, root: string, phase: StopPhase) {
  const child = fork(path.join(directory, "child.mjs"), [root, phase], {
    execArgv: [],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  children.set(
    child,
    new Promise((resolve) => child.once("exit", () => resolve())),
  );
  let stderr = "";
  child.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
  });
  const ready = await new Promise<{ phase: StopPhase; stage: string }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Child did not reach ${phase}: ${stderr}`));
      }, 10_000);
      const onExit = () => {
        cleanup();
        reject(new Error(`Child exited before ${phase}: ${stderr}`));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onMessage = (value: unknown) => {
        cleanup();
        resolve(value as { phase: StopPhase; stage: string });
      };
      function cleanup() {
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("error", onError);
        child.off("message", onMessage);
      }
      child.once("exit", onExit);
      child.once("error", onError);
      child.once("message", onMessage);
    },
  );
  expect(ready.phase).toBe(phase);
  await stop(child);
  expect(child.signalCode).toBe("SIGKILL");
  return ready.stage;
}

describe.skipIf(process.platform !== "linux")(
  "actual process interruption recovery",
  () => {
    it.each<StopPhase>(["verification", "before-rename", "after-rename"])(
      "preserves transaction ownership and recovers after SIGKILL at %s",
      async (phase) => {
        const { directory, root } = await fixture();
        const stage = await interrupt(directory, root, phase);
        const expected =
          phase === "after-rename" ? request.patchContent : "original";
        const target = path.join(root, request.filePath);
        expect(await fs.readFile(target, "utf8")).toBe(expected);
        const journal = JSON.parse(
          await fs.readFile(
            path.join(root, ".ryan-patch/lock/journal.json"),
            "utf8",
          ),
        );
        expect(journal.phase).toBe(
          phase === "verification" ? "preparing" : "promoting",
        );

        // A different process cannot steal a dead writer's ownership or overwrite it.
        const blocked = await applyWorkspacePatch(root, {
          ...request,
          patchContent: "other writer",
        });
        expect(blocked.status).toBe("failed");
        expect(blocked.error).toContain("requires recovery");
        expect(await fs.readFile(target, "utf8")).toBe(expected);

        expect(await recoverWorkspacePatch(root, true)).toEqual({
          status: phase === "after-rename" ? "committed" : "aborted",
        });
        // Post-rename recovery must preserve the verified bytes, never restore a snapshot.
        expect(await fs.readFile(target, "utf8")).toBe(expected);
        await expect(
          fs.stat(path.join(root, ".ryan-patch/lock")),
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(fs.stat(stage)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
          fs.stat(path.join(root, journal.temporaryPath)),
        ).rejects.toMatchObject({ code: "ENOENT" });
        expect(await recoverWorkspacePatch(root, true)).toEqual({
          status: "nothing_to_recover",
        });
      },
      20_000,
    );
  },
);
