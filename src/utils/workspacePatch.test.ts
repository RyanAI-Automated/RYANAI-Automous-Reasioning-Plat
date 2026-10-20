import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
const roots: string[] = [];
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const patch = { filePath: "src/app.ts", patchContent: "accepted" };

async function fixture() {
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
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("workspace patch transaction", () => {
  it("validates a private snapshot and promotes only the original candidate bytes", async () => {
    const root = await fixture();
    verify.mockImplementation(async (stage, script) => {
      expect(stage.startsWith(root + path.sep)).toBe(false);
      expect(script).toBe("optional-script");
      expect(await read(root)).toBe("original");
      expect(await read(stage)).toBe("accepted");
      await expect(read(stage, ".env")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(read(stage, "untracked.txt")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(fs.stat(path.join(stage, ".git"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      // Even a misbehaving validator must never supply replacement bytes for promotion.
      await fs.writeFile(
        path.join(stage, patch.filePath),
        "validator-generated content",
      );
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
    await expect(
      fs.stat(path.join(root, ".ryan-patch/lock")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves original content unchanged on validation failure and exceptions", async () => {
    const root = await fixture();
    verify.mockResolvedValueOnce({ success: false, error: "failed checks" });
    expect((await applyWorkspacePatch(root, patch)).status).toBe("rejected");
    expect(await read(root)).toBe("original");
    verify.mockRejectedValueOnce(new Error("worker unavailable"));
    expect((await applyWorkspacePatch(root, patch)).status).toBe("failed");
    expect(await read(root)).toBe("original");
  });

  it("rejects overlapping requests instead of allowing stale rollback", async () => {
    const root = await fixture();
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    verify.mockImplementationOnce(async () => {
      started();
      await gate;
      return { success: false, error: "late failure" };
    });
    const first = applyWorkspacePatch(root, patch);
    await entered;
    expect(
      (await applyWorkspacePatch(root, { ...patch, patchContent: "second" }))
        .error,
    ).toContain("busy");
    expect(await read(root)).toBe("original");
    release();
    expect((await first).status).toBe("rejected");
    expect(
      (await applyWorkspacePatch(root, { ...patch, patchContent: "second" }))
        .status,
    ).toBe("success");
    expect(await read(root)).toBe("second");
  });

  it.each([patch.filePath, "package.json"])(
    "rejects changes to %s during validation without rollback",
    async (file) => {
      const root = await fixture();
      verify.mockImplementationOnce(async () => {
        await fs.writeFile(path.join(root, file), "external update");
        return { success: true };
      });
      expect((await applyWorkspacePatch(root, patch)).status).toBe("conflict");
      expect(await read(root, file)).toBe("external update");
    },
  );

  it("rejects additions so accepted files cannot disappear from later validation", async () => {
    const root = await fixture();
    const addition = { filePath: "src/new.ts", patchContent: "new file" };
    expect((await applyWorkspacePatch(root, addition)).status).toBe("failed");
    expect(verify).not.toHaveBeenCalled();
    await expect(read(root, addition.filePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await applyWorkspacePatch(root, patch)).status).toBe("success");
    verify.mockImplementationOnce(async (stage) => {
      expect(await read(stage)).toBe("accepted");
      return { success: true };
    });
    expect((await applyWorkspacePatch(root, patch)).status).toBe("success");
  });

  it("preserves executable mode despite a restrictive umask", async () => {
    const root = await fixture();
    await fs.chmod(path.join(root, patch.filePath), 0o755);
    verify.mockImplementationOnce(async (stage) => {
      expect((await fs.stat(stage)).mode & 0o777).toBe(0o755);
      expect((await fs.stat(path.join(stage, "src"))).mode & 0o777).toBe(0o755);
      expect(
        (await fs.stat(path.join(stage, patch.filePath))).mode & 0o777,
      ).toBe(0o755);
      return { success: true };
    });
    expect((await applyWorkspacePatch(root, patch)).status).toBe("success");
    expect((await fs.stat(path.join(root, patch.filePath))).mode & 0o777).toBe(
      0o755,
    );
  });

  it.each([
    "../escape",
    "/tmp/escape",
    ".git/config",
    ".env",
    ".npmrc",
    ".ryan-patch/state",
    "src/../../escape",
    "src\\app.ts",
    "untracked.txt",
  ])(
    "rejects unsafe/untracked target %s before executing validation",
    async (filePath) => {
      const root = await fixture();
      expect(
        (await applyWorkspacePatch(root, { ...patch, filePath })).status,
      ).toBe("failed");
      expect(verify).not.toHaveBeenCalled();
      expect(await read(root)).toBe("original");
    },
  );

  it("rejects symlink parents and a symlink state directory", async () => {
    const root = await fixture();
    const outside = await fixture();
    await fs.symlink(path.join(outside, "src"), path.join(root, "alias"));
    expect(
      (await applyWorkspacePatch(root, { ...patch, filePath: "alias/app.ts" }))
        .status,
    ).toBe("failed");
    expect(await read(outside)).toBe("original");
    await fs.rm(path.join(root, ".ryan-patch"), { recursive: true });
    await fs.symlink(path.join(outside, "src"), path.join(root, ".ryan-patch"));
    expect((await applyWorkspacePatch(root, patch)).status).toBe("failed");
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects symbolic and hard-linked tracked files", async () => {
    const root = await fixture();
    await fs.link(path.join(root, patch.filePath), path.join(root, "alias"));
    expect((await applyWorkspacePatch(root, patch)).status).toBe("failed");
    await fs.unlink(path.join(root, "alias"));
    await fs.unlink(path.join(root, patch.filePath));
    await fs.symlink("../package.json", path.join(root, patch.filePath));
    expect((await applyWorkspacePatch(root, patch)).status).toBe("failed");
    expect(verify).not.toHaveBeenCalled();
  });
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
    const root = await fixture();
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
    expect(await read(root)).toBe("original");
  });

  it.each(["original", "accepted"])(
    "recovers an interruption around atomic rename with %s bytes",
    async (content) => {
      const root = await fixture();
      const temporary = await interrupted(root, "promoting", content);
      expect(await recoverWorkspacePatch(root, true)).toEqual({
        status: content === "accepted" ? "committed" : "aborted",
      });
      expect(await read(root)).toBe(content);
      await expect(read(root, temporary)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await recoverWorkspacePatch(root, true)).toEqual({
        status: "nothing_to_recover",
      });
    },
  );

  it("preserves conflicting content and the journal for investigation", async () => {
    const root = await fixture();
    await interrupted(root, "promoting", "another writer");
    await expect(recoverWorkspacePatch(root, true)).rejects.toThrow(
      "Recovery conflict",
    );
    expect(await read(root)).toBe("another writer");
    expect(
      await fs.stat(path.join(root, ".ryan-patch/lock/journal.json")),
    ).toBeDefined();
  });

  it("returns a structured failure when releasing ownership fails", async () => {
    const root = await fixture();
    const { rename } =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (String(from) === path.join(root, ".ryan-patch/lock"))
        throw new Error("injected retirement failure");
      return rename(from, to);
    });
    expect((await applyWorkspacePatch(root, patch)).error).toContain(
      "cleanup failed",
    );
    expect(await read(root)).toBe("accepted");
    vi.mocked(fs.rename).mockImplementation(rename);
    expect(await recoverWorkspacePatch(root, true)).toEqual({
      status: "committed",
    });
  });

  it("retains a journal when rename fails, then recovers without touching the original", async () => {
    const root = await fixture();
    const { rename } =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (String(to) === path.join(root, patch.filePath))
        throw new Error("injected rename failure");
      return rename(from, to);
    });
    expect((await applyWorkspacePatch(root, patch)).error).toContain(
      "Recovery is required",
    );
    expect(await read(root)).toBe("original");
    vi.mocked(fs.rename).mockImplementation(rename);
    expect(await recoverWorkspacePatch(root, true)).toEqual({
      status: "aborted",
    });
    expect((await applyWorkspacePatch(root, patch)).status).toBe("success");
  });
});
