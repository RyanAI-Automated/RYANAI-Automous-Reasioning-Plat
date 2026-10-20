import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerificationPipeline } from "./verifyPatch.js";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: execute }));

const image = `registry.example/patch-verifier@sha256:${"a".repeat(64)}`;
const directories: string[] = [];
let cwd: string;
type Callback = (error: Error | null, stdout: string) => void;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "ryanai-verification-"));
  directories.push(cwd);
  vi.stubEnv("RYAN_PATCH_VERIFIER_IMAGE", image);
  execute.mockReset();
  execute.mockImplementation(
    (_file, args: string[], _options, callback: Callback) => {
      callback(null, args[2] === "inspect" ? "exited 0\n" : "");
    },
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("isolated patch verification gate", () => {
  it.each(["", "registry.example/verifier:latest", "x@sha256:short"])(
    "rejects unpinned or missing image configuration (%s) without executing commands",
    async (configuredImage) => {
      vi.stubEnv("RYAN_PATCH_VERIFIER_IMAGE", configuredImage);
      expect((await runVerificationPipeline(cwd)).success).toBe(false);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("uses only an isolated local container and removes it before accepting", async () => {
    vi.stubEnv("APPLICATION_SECRET", "must-not-reach-worker");
    vi.stubEnv("DOCKER_HOST", "tcp://untrusted.example:1234");
    expect(await runVerificationPipeline(cwd)).toEqual({ success: true });
    const calls = execute.mock.calls;
    expect(calls.map((call) => call[1][2])).toEqual([
      "create",
      "start",
      "inspect",
      "rm",
    ]);
    for (const [executable, args, options] of calls) {
      expect(executable).toBe("/usr/bin/docker");
      expect(args.slice(0, 2)).toEqual([
        "--host",
        "unix:///var/run/docker.sock",
      ]);
      expect(options.env).toEqual({
        PATH: "/usr/bin:/bin",
        HOME: options.env.HOME,
        DOCKER_CONFIG: options.env.HOME,
      });
      expect(options.env).not.toHaveProperty("APPLICATION_SECRET");
      expect(options.env).not.toHaveProperty("DOCKER_HOST");
      expect(options.cwd).toBe("/");
      expect(options.killSignal).toBe("SIGKILL");
      expect(options.maxBuffer).toBe(1024 * 1024);
    }
    const create = calls[0][1] as string[];
    for (const flag of [
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
    ])
      expect(create).toContain(flag);
    expect(create).toContain(`type=bind,src=${cwd},dst=/input,readonly`);
    expect(create.filter((arg) => arg.startsWith("type=bind"))).toHaveLength(1);
    expect(create).toContain(image);
    expect(create.at(-1)).toContain("npm run validate");
    expect(create.at(-1)).toContain(
      "cmp /work/package-lock.json /opt/patch-deps/package-lock.json",
    );
    expect(calls[1][2].timeout).toBe(300_000);
    expect(calls[3][1]).toEqual([
      "--host",
      "unix:///var/run/docker.sock",
      "rm",
      "--force",
      create[4],
    ]);
    await expect(access(calls[0][2].env.HOME)).rejects.toThrow();
  });

  it("passes an optional script as read-only data, never as host command text", async () => {
    const script = 'console.log("$(touch /host-sentinel)");';
    let contents: Promise<string> | undefined;
    let permissions: Promise<number> | undefined;
    execute.mockImplementation(
      (_file, args: string[], _options, callback: Callback) => {
        if (args[2] === "create") {
          const mount = args.find((arg) =>
            arg.includes("dst=/verification-script.js"),
          )!;
          const scriptPath = mount.split("src=")[1].split(",dst=")[0];
          contents = readFile(scriptPath, "utf8");
          permissions = stat(scriptPath).then((info) => info.mode & 0o777);
          void Promise.all([contents, permissions]).then(() =>
            callback(null, ""),
          );
        } else callback(null, args[2] === "inspect" ? "exited 0" : "");
      },
    );
    expect(await runVerificationPipeline(cwd, script)).toEqual({
      success: true,
    });
    expect(await contents).toBe(script);
    expect(await permissions).toBe(0o644);
    expect(execute.mock.calls.flatMap((call) => call[1])).not.toContain(script);
  });

  it.each(["create", "start", "inspect"])(
    "rejects %s errors and still attempts cleanup",
    async (stage) => {
      execute.mockImplementation(
        (_file, args: string[], _options, callback: Callback) => {
          callback(
            args[2] === stage ? new Error("private candidate output") : null,
            "",
          );
        },
      );
      const result = await runVerificationPipeline(cwd);
      expect(result.success).toBe(false);
      expect(result.error).not.toContain("private candidate output");
      expect(execute.mock.calls.at(-1)?.[1][2]).toBe("rm");
    },
  );

  it.each(["exited 7", "running 0", "created 0", ""])(
    "rejects unsuccessful container state %s",
    async (state) => {
      execute.mockImplementation(
        (_file, args: string[], _options, callback: Callback) => {
          callback(null, args[2] === "inspect" ? state : "");
        },
      );
      expect((await runVerificationPipeline(cwd)).success).toBe(false);
      expect(execute.mock.calls.at(-1)?.[1][2]).toBe("rm");
    },
  );

  it("rejects cleanup failure even after successful validation", async () => {
    execute.mockImplementation(
      (_file, args: string[], _options, callback: Callback) => {
        callback(
          args[2] === "rm" ? new Error("daemon failure") : null,
          args[2] === "inspect" ? "exited 0" : "",
        );
      },
    );
    expect(await runVerificationPipeline(cwd)).toEqual({
      success: false,
      error: "Patch verifier cleanup failed; promotion refused.",
    });
  });

  it("does not report success until the container has been removed", async () => {
    let remove: Callback | undefined;
    let removalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      removalStarted = resolve;
    });
    execute.mockImplementation(
      (_file, args: string[], _options, callback: Callback) => {
        if (args[2] === "rm") {
          remove = callback;
          removalStarted();
        } else callback(null, args[2] === "inspect" ? "exited 0" : "");
      },
    );
    let completed = false;
    const verification = runVerificationPipeline(cwd).then((result) => {
      completed = true;
      return result;
    });
    await started;
    expect(completed).toBe(false);
    remove!(null, "");
    expect(await verification).toEqual({ success: true });
  });

  it("refuses ambiguous mount paths before executing Docker", async () => {
    const ambiguous = await mkdtemp(join(tmpdir(), "patch,readonly,"));
    directories.push(ambiguous);
    expect((await runVerificationPipeline(ambiguous)).success).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
