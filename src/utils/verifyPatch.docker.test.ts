import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runVerificationPipeline } from "./verifyPatch.js";

// Deliberate opt-in: requires a trusted preloaded image matching this checkout's
// dependency manifests. This suite uses real Docker, unlike verifyPatch.test.ts.
const enabled =
  process.env.RYAN_PATCH_DOCKER_TEST === "1" &&
  !!process.env.RYAN_PATCH_VERIFIER_IMAGE &&
  existsSync("/usr/bin/docker");
const directories: string[] = [];

async function fixture(exitCode = 0) {
  const cwd = await mkdtemp(join(tmpdir(), "ryan-real-verifier-"));
  directories.push(cwd);
  await chmod(cwd, 0o755);
  const packagePath = fileURLToPath(
    new URL("../../package.json", import.meta.url),
  );
  const lockPath = fileURLToPath(
    new URL("../../package-lock.json", import.meta.url),
  );
  const manifest = JSON.parse(await readFile(packagePath, "utf8"));
  manifest.scripts = { validate: "node check.cjs" };
  for (const [name, content] of [
    ["package.json", JSON.stringify(manifest)],
    ["package-lock.json", await readFile(lockPath, "utf8")],
    ["check.cjs", `process.exit(${exitCode});`],
  ]) {
    await writeFile(join(cwd, name), content);
    await chmod(join(cwd, name), 0o644);
  }
  return cwd;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe.skipIf(!enabled)("real Docker patch verifier", () => {
  it("accepts valid code while denying live files, credentials, socket and network", async () => {
    const cwd = await fixture();
    const original = await readFile(join(cwd, "package.json"), "utf8");
    const privateDirectory = await mkdtemp(
      join(tmpdir(), "ryan-unmounted-private-"),
    );
    directories.push(privateDirectory);
    const hostSecret = join(privateDirectory, "host-secret");
    await writeFile(hostSecret, "host-only-sentinel");
    vi.stubEnv("RYAN_VERIFIER_SECRET_SENTINEL", "parent-only-sentinel");
    const script = `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const os = require('node:os');
      const net = require('node:net');
      assert.equal(process.env.RYAN_VERIFIER_SECRET_SENTINEL, undefined);
      assert.equal(process.getuid(), 65534);
      assert.throws(() => fs.writeFileSync('/input/package.json', 'corrupted'));
      assert.throws(() => fs.readFileSync(${JSON.stringify(hostSecret)}));
      assert.equal(fs.existsSync('/var/run/docker.sock'), false);
      for (const addresses of Object.values(os.networkInterfaces())) {
        for (const address of addresses) assert.equal(address.internal, true);
      }
      const socket = net.connect({host: '203.0.113.1', port: 443});
      socket.on('connect', () => { socket.destroy(); process.exitCode = 1; });
      socket.on('error', () => socket.destroy());
      socket.setTimeout(2000, () => socket.destroy());
    `;
    expect(await runVerificationPipeline(cwd, script)).toEqual({
      success: true,
    });
    expect(await readFile(join(cwd, "package.json"), "utf8")).toBe(original);
    expect(await readFile(hostSecret, "utf8")).toBe("host-only-sentinel");
  }, 360_000);

  it("rejects a real nonzero validation exit", async () => {
    expect((await runVerificationPipeline(await fixture(7))).success).toBe(
      false,
    );
  }, 360_000);

  it("rejects a candidate lockfile that differs from the approved image", async () => {
    const cwd = await fixture();
    await writeFile(join(cwd, "package-lock.json"), "{}");
    expect((await runVerificationPipeline(cwd)).success).toBe(false);
  }, 360_000);
});