import { execFile, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
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
const patch = { filePath: "src/app.ts", patchContent: "accepted" };

afterEach(async () => {
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

const read = (root: string, file = patch.filePath) =>
  fs.readFile(path.join(root, file), "utf8");

beforeEach(() => {
  verify.mockReset();
  verify.mockResolvedValue({ success: true });
});

describe("workspace patch transaction", () => {
  it("validates a private snapshot and promotes only the original candidate bytes", async () => {
    const root = await standardFixture();
    verify.mockImplementation(async (stage, script) => {
      expect(stage.startsWith(root + path.sep)).toBe(false);
      expect(script).toBe("optional-script");
      expect(await read(root)).toBe("original");
      expect(await read(stage)).toBe("accepted");
      return { success: true };
    });
    expect(
      (
        await applyWorkspacePatch(root, {
          ...patch,
          testScript: "optional-script",
        })
      ).status,
    ).toBe("success");
    expect(await read(root)).toBe("accepted");
  });

  it("leaves original content unchanged on validation failure and exceptions", async () => {
    const root = await standardFixture();
    verify.mockResolvedValueOnce({ success: false, error: "failed checks" });
    expect((await applyWorkspacePatch(root, patch)).status).toBe("rejected");
    expect(await read(root)).toBe("original");
  });
});