import { execFile, fork, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyWorkspacePatch,
  recoverWorkspacePatch,
} from "./workspacePatch.js";
import { runVerificationPipeline } from "./verifyPatch.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
vi.mock("./verifyPatch.js", () => ({ runVerificationPipeline: vi.fn() }));

const verify = vi.mocked(runVerificationPipeline);
const execFileAsync = promisify(execFile);
const directories: string[] = [];
const workspaces: string[] = [];
const roots: string[] = [];
const children = new Map<ChildProcess, Promise<void>>();
const request = { filePath: "src/app.ts", patchContent: "verified candidate" };
const patch = { filePath: "src/app.ts", patchContent: "accepted" };
type StopPhase = "verification" | "before-rename" | "after-rename";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");

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
  vi.restoreAllMocks();

  for (const root of workspaces.splice(0)) {
    await recoverWorkspacePatch(root, true);
  }
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function standardFixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "workspace-patch-test-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, patch.filePath), "original");
  await fs.writeFile(
    path.join(root, "package.json"),
    '{"scripts":{"validate":"exit 0"}}',
  );
  await fs.writeFile(path.join(root, ".env"), "fixture-only-secret");
  await fs.writeFile(path.join(root, "untracked.txt"), "not part of candidate");
  for (const args of [
    ["init", "-q"],
    ["add", "src", "package.json", ".env"],
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
  return root;
}

beforeEach(() => {
  verify.mockReset();
  verify.mockResolvedValue({ success: true });
});

async function interrupted(
  root: string,
  phase: string,
  content: string | null = "original",
) {
  const id = randomUUID();
  const temporaryPath = `src/.ryan-patch-${id}.tmp`;
  await fs.mkdir(path.join(root, ".ryan-patch"), { mode: 0o700 });
  await fs.mkdir(path.join(root, ".ryan-patch/lock"), { mode: 0o700 });
  await fs.writeFile(
    path.join(root, ".ryan-patch/lock/journal.json"),
    JSON.stringify({
      version: 1,
      id,
      phase,
      filePath: patch.filePath,
      temporaryPath,
      originalHash: digest("original"),
      candidateHash: digest("accepted"),
    }),
  );
  if (content === null) await fs.unlink(path.join(root, patch.filePath));
  else await fs.writeFile(path.join(root, patch.filePath), content);
  await fs.writeFile(path.join(root, temporaryPath), "accepted");
  return temporaryPath;
}

describe("explicit crash recovery", () => {
  it("requires quiescence confirmation and never steals an existing lock", async () => {
    const root = await standardFixture();
    await interrupted(root, "preparing");
    await expect(recoverWorkspacePatch(root, false)).rejects.toThrow(
      "Stop all workspace writers",
    );
    expect((await applyWorkspacePatch(root, patch)).error).toContain(
      "recovery",
    );
    expect(verify).not.toHaveBeenCalled();
    expect(await recoverWorkspacePatch(root, true)).toEqual({
      status: "aborted",
    });
    expect(await fs.readFile(path.join(root, patch.filePath), "utf8")).toBe("original");
  });

  it.each(["original", "accepted"])(
    "recovers an interruption around atomic rename with %s bytes",
    async (content) => {
      const root = await standardFixture();
      await interrupted(root, "promoting", content);
      expect(await recoverWorkspacePatch(root, true)).toEqual({
        status: content === "accepted" ? "committed" : "aborted",
      });
    },
  );
});