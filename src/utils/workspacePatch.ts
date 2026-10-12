import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { PatchRequest } from "../engine/selfPatchSkill.js";
import { runVerificationPipeline } from "./verifyPatch.js";

const execFileAsync = promisify(execFile);
const STATE = ".ryan-patch";
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
type Phase = "preparing" | "validated" | "promoting" | "committed";
interface Journal {
  version: 1;
  id: string;
  phase: Phase;
  filePath: string;
  originalHash: string | null;
  candidateHash: string;
  temporaryPath: string;
}
interface Snapshot {
  revision: string;
  files: Map<string, { content: Buffer; mode: number }>;
}

function hash(content: Buffer | string) {
  return createHash("sha256").update(content).digest("hex");
}
function stageDirectory(root: string, id: string) {
  return path.join("/tmp", `ryan-patch-stage-${hash(root)}-${id}`);
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
function allowed(relative: string) {
  const parts = relative.split("/");
  return (
    relative.length > 0 &&
    !path.isAbsolute(relative) &&
    !relative.includes("\\") &&
    parts.every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        ![".git", STATE, "node_modules", ".ssh", ".aws", ".config"].includes(
          part,
        ) &&
        !part.startsWith(".env") &&
        !part.startsWith(".ryan-patch-") &&
        ![".npmrc", ".netrc", ".git-credentials"].includes(part) &&
        !/\.(pem|key|p12|pfx)$/i.test(part),
    )
  );
}

/** Reject links throughout the path; the final file may be absent, parents may not. */
async function inspect(root: string, relative: string) {
  if (!allowed(relative))
    throw new Error("Patch path is outside the permitted workspace files.");
  const parts = relative.split("/");
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (isMissing(error) && i === parts.length - 1) return null;
      throw error;
    }
    if (stat.isSymbolicLink())
      throw new Error(`Symbolic links are not patchable: ${relative}`);
    if (i < parts.length - 1 && !stat.isDirectory())
      throw new Error("Invalid parent directory.");
    if (i === parts.length - 1) {
      if (!stat.isFile() || stat.nlink !== 1)
        throw new Error("Only regular, unlinked files are patchable.");
      if (stat.size > MAX_FILE_BYTES)
        throw new Error("Workspace file exceeds the snapshot limit.");
      return stat;
    }
  }
  return null;
}
async function readTarget(root: string, relative: string) {
  return (await inspect(root, relative))
    ? fs.readFile(path.join(root, relative))
    : null;
}
async function syncDirectory(directory: string) {
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function durableWrite(
  filename: string,
  content: string | Buffer,
  mode = 0o600,
) {
  const handle = await fs.open(filename, "wx", mode);
  try {
    await handle.writeFile(content);
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function saveJournal(lock: string, journal: Journal) {
  const temporary = path.join(lock, `journal-${randomUUID()}.tmp`);
  await durableWrite(temporary, JSON.stringify(journal));
  await fs.rename(temporary, path.join(lock, "journal.json"));
  await syncDirectory(lock);
}
async function stateDirectory(root: string) {
  const state = path.join(root, STATE);
  await fs.mkdir(state, { mode: 0o700 }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  const stat = await fs.lstat(state);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new Error(
      "Patch state must be a private directory owned by the application.",
    );
  }
  if (stat.uid !== process.getuid?.())
    throw new Error("Patch state has a different owner.");
  await syncDirectory(root);
  return state;
}
async function git(root: string, args: string[]) {
  const result = await execFileAsync(
    "/usr/bin/git",
    ["-c", "core.fsmonitor=false", "-C", root, ...args],
    {
      env: {
        PATH: "/usr/bin:/bin",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  return result.stdout;
}

/** Only tracked source files enter the worker. Ignored/untracked credentials never do. */
async function snapshot(root: string): Promise<Snapshot> {
  const top = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
  if ((await fs.realpath(top)) !== root)
    throw new Error("Patch workspace must be the Git repository root.");
  const entries = await git(root, ["ls-files", "--stage", "-z"]);
  const head = await git(root, ["rev-parse", "HEAD"]);
  const digest = createHash("sha256").update(head).update(entries);
  const files: Snapshot["files"] = new Map();
  let size = 0;
  for (const entry of entries.split("\0").filter(Boolean)) {
    const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry);
    if (!match || match[3] !== "0")
      throw new Error("Resolve the Git index conflicts before patching.");
    const [, mode, , , relative] = match;
    if (mode === "160000") continue; // Gitlinks are not part of this repository's source snapshot.
    if (!allowed(relative)) continue;
    const stat = await inspect(root, relative);
    if (!stat) throw new Error(`Tracked file is missing: ${relative}`);
    const content = await fs.readFile(path.join(root, relative));
    size += content.length;
    if (size > MAX_SNAPSHOT_BYTES)
      throw new Error("Workspace exceeds the snapshot limit.");
    const fileMode = stat.mode & 0o777;
    digest.update(JSON.stringify([relative, fileMode, hash(content)]));
    files.set(relative, { content, mode: fileMode });
  }
  return { revision: digest.digest("hex"), files };
}

interface PatchOwnership {
  lock?: string;
  stagingRoot?: string;
  promotionStarted: boolean;
}

async function acquirePatchLock(root: string, ownership: PatchOwnership) {
  const state = await stateDirectory(root);
  const lock = path.join(state, "lock");
  try {
    await fs.mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Workspace patch is busy or requires recovery.", {
        cause: error,
      });
    }
    throw error;
  }
  ownership.lock = lock;
  await syncDirectory(state);
  return lock;
}

async function stageSnapshot(
  stage: string,
  baseline: Snapshot,
  request: PatchRequest,
) {
  await fs.mkdir(stage, { mode: 0o755 });
  await fs.chmod(stage, 0o755);
  for (const [relative, file] of baseline.files) {
    const target = path.join(stage, relative);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    let directory = path.dirname(target);
    while (directory !== stage) {
      await fs.chmod(directory, 0o755);
      directory = path.dirname(directory);
    }
    await fs.writeFile(target, file.content);
    await fs.chmod(target, file.mode & 0o111 ? 0o755 : 0o644);
  }
  const stagedTarget = path.join(stage, request.filePath);
  await fs.mkdir(path.dirname(stagedTarget), { recursive: true, mode: 0o755 });
  await fs.writeFile(stagedTarget, request.patchContent);
  await fs.chmod(
    stagedTarget,
    (baseline.files.get(request.filePath)?.mode ?? 0) & 0o111 ? 0o755 : 0o644,
  );
}

async function revisionMatches(
  root: string,
  baseline: Snapshot,
  journal: Journal,
) {
  const latest = await snapshot(root);
  const current = await readTarget(root, journal.filePath);
  return (
    baseline.revision === latest.revision &&
    (current === null ? null : hash(current)) === journal.originalHash
  );
}

async function promotePatch(
  root: string,
  lock: string,
  journal: Journal,
  baseline: Snapshot,
  request: PatchRequest,
  ownership: PatchOwnership,
) {
  const parent = path.dirname(path.join(root, request.filePath));
  // Persist intent before creating a same-filesystem promotion file. Never restore a stale snapshot.
  journal.phase = "promoting";
  await saveJournal(lock, journal);
  ownership.promotionStarted = true;
  const temporary = path.join(root, journal.temporaryPath);
  const mode = baseline.files.get(request.filePath)?.mode ?? 0o644;
  await durableWrite(temporary, request.patchContent, mode);
  await fs.rename(temporary, path.join(root, request.filePath));
  await syncDirectory(parent);
  journal.phase = "committed";
  await saveJournal(lock, journal);
  ownership.promotionStarted = false;
}

async function executePatch(
  workspace: string,
  request: PatchRequest,
  ownership: PatchOwnership,
) {
  if (process.platform !== "linux")
    throw new Error("Workspace patching requires Linux.");
  const root = await fs.realpath(workspace);
  if (
    typeof request.patchContent !== "string" ||
    Buffer.byteLength(request.patchContent) > 8 * 1024 * 1024
  ) {
    throw new Error("Patch content must be a string no larger than 8 MiB.");
  }
  const lock = await acquirePatchLock(root, ownership);
  const original = await readTarget(root, request.filePath);
  const baseline = await snapshot(root);
  if (original === null || !baseline.files.has(request.filePath)) {
    throw new Error("Patch targets must be existing files tracked by Git.");
  }
  const id = randomUUID();
  const journal: Journal = {
    version: 1,
    id,
    phase: "preparing",
    filePath: request.filePath,
    originalHash: hash(original),
    candidateHash: hash(request.patchContent),
    temporaryPath: path.posix.join(
      path.posix.dirname(request.filePath),
      `.ryan-patch-${id}.tmp`,
    ),
  };
  await saveJournal(lock, journal);
  const stagingRoot = stageDirectory(root, id);
  await fs.mkdir(stagingRoot, { mode: 0o700 });
  ownership.stagingRoot = stagingRoot;
  const stage = path.join(stagingRoot, "source");
  await stageSnapshot(stage, baseline, request);
  const verification = await runVerificationPipeline(stage, request.testScript);
  if (!verification.success) {
    return {
      status: "rejected",
      error: `Patch validation failed: ${verification.error}`,
    };
  }
  journal.phase = "validated";
  await saveJournal(lock, journal);
  if (!(await revisionMatches(root, baseline, journal))) {
    return {
      status: "conflict",
      error:
        "Workspace changed during validation; retry against the new revision.",
    };
  }
  await promotePatch(root, lock, journal, baseline, request, ownership);
  return {
    status: "success",
    message: `Successfully updated and verified ${request.filePath}`,
  };
}

async function cleanupPatch(ownership: PatchOwnership) {
  const { lock, stagingRoot, promotionStarted } = ownership;
  // A crash or uncertain promotion leaves ownership/journal intact for explicit recovery.
  if (!lock || promotionStarted) return;
  if (stagingRoot) await fs.rm(stagingRoot, { recursive: true, force: true });
  const retired = path.join(path.dirname(lock), `finished-${randomUUID()}`);
  await fs.rename(lock, retired);
  await syncDirectory(path.dirname(lock));
  await fs.rm(retired, { recursive: true, force: true });
}

/** All cooperating writers must hold this lock; crashes deliberately leave it for recovery. */
export async function applyWorkspacePatch(
  workspace: string,
  request: PatchRequest,
) {
  const ownership: PatchOwnership = { promotionStarted: false };
  let result;
  try {
    result = await executePatch(workspace, request, ownership);
  } catch (error) {
    result = {
      status: "failed",
      error: `${message(error)}${ownership.promotionStarted ? " Recovery is required before another patch." : ""}`,
    };
  }
  try {
    await cleanupPatch(ownership);
  } catch {
    return {
      status: "failed",
      error:
        "Patch cleanup failed; inspect recovery state before retrying. A verified patch may already be committed.",
    };
  }
  return result;
}

async function recoveryLockExists(lock: string) {
  let stat;
  try {
    stat = await fs.lstat(lock);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Invalid recovery lock.");
  return true;
}

async function readRecoveryJournal(lock: string) {
  try {
    return JSON.parse(
      await fs.readFile(path.join(lock, "journal.json"), "utf8"),
    ) as Journal;
  } catch (error) {
    if (!isMissing(error)) throw error;
    return undefined;
  }
}

function validateRecoveryJournal(journal: Journal) {
  if (
    journal.version !== 1 ||
    !allowed(journal.filePath) ||
    !/^[a-f0-9-]{36}$/.test(journal.id) ||
    journal.temporaryPath !==
      path.posix.join(
        path.posix.dirname(journal.filePath),
        `.ryan-patch-${journal.id}.tmp`,
      ) ||
    !["preparing", "validated", "promoting", "committed"].includes(
      journal.phase,
    )
  ) {
    throw new Error("Invalid recovery journal; manual investigation required.");
  }
}

async function recoverPromotion(root: string, journal: Journal) {
  if (journal.phase !== "promoting" && journal.phase !== "committed")
    return "aborted";
  const content = await readTarget(root, journal.filePath);
  const currentHash = content === null ? null : hash(content);
  let status = "aborted";
  if (currentHash === journal.candidateHash) status = "committed";
  else if (
    currentHash !== journal.originalHash ||
    journal.phase === "committed"
  ) {
    throw new Error(
      "Recovery conflict: preserve workspace and journal for manual investigation.",
    );
  }
  // Recheck parents through readTarget before removing only this transaction's temporary file.
  await fs.rm(path.join(root, journal.temporaryPath), { force: true });
  await syncDirectory(path.dirname(path.join(root, journal.filePath)));
  return status;
}

/** Operator-only: stop ALL writers first. Never expose this through the agent/MCP tools. */
export async function recoverWorkspacePatch(
  workspace: string,
  confirmQuiescent: boolean,
) {
  if (!confirmQuiescent)
    throw new Error("Stop all workspace writers before confirming recovery.");
  const root = await fs.realpath(workspace);
  const state = await stateDirectory(root);
  const lock = path.join(state, "lock");
  if (!(await recoveryLockExists(lock)))
    return { status: "nothing_to_recover" };
  const journal = await readRecoveryJournal(lock);
  let status = "aborted";
  if (journal) {
    validateRecoveryJournal(journal);
    status = await recoverPromotion(root, journal);
    await fs.rm(stageDirectory(root, journal.id), {
      recursive: true,
      force: true,
    });
  }
  const retired = path.join(state, `finished-${randomUUID()}`);
  await fs.rename(lock, retired);
  await syncDirectory(state);
  await fs.rm(retired, { recursive: true });
  await syncDirectory(state);
  return { status };
}
