#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const tools = ["cs-script.cli", "cs-syntaxer"];
const sdkHelp =
  "Install the .NET SDK from https://dotnet.microsoft.com/en-us/download, then restart your terminal.";

/** Run the .NET CLI, optionally capturing stdout, and throw on launch or exit failure. */
function runDotnet(args, capture = false) {
  const result = spawnSync("dotnet", args, {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) {
    throw new Error(
      result.error.code === "ENOENT" ? sdkHelp : result.error.message,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `dotnet ${args.join(" ")} failed (${result.signal ?? result.status}).${result.stderr ? `\n${result.stderr.trim()}` : ""}`,
    );
  }
  return result.stdout ?? "";
}

/**
 * Require an installed .NET SDK, then install or update the global CS-Script tools.
 * The command runner and logger can be injected for tests; command failures propagate.
 */
export function setupCsScript(run = runDotnet, log = console.log) {
  if (!run(["--list-sdks"], true).trim()) {
    throw new Error(`No .NET SDK was found. ${sdkHelp}`);
  }

  const installed = new Set(
    run(["tool", "list", "--global"], true)
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0].toLowerCase()),
  );
  for (const tool of tools) {
    const action = installed.has(tool) ? "update" : "install";
    log(`Running dotnet tool ${action} --global ${tool}`);
    run(["tool", action, "--global", tool]);
  }

  log(
    "CS-Script tools are ready. Ensure the .NET global tools directory is on PATH ($HOME/.dotnet/tools on Linux/macOS, %USERPROFILE%\\.dotnet\\tools on Windows).",
  );
  log(
    'Restart VS Code and run "CS-Script: Detect and integrate CS-Script" from the Command Palette.',
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    setupCsScript();
  } catch (error) {
    console.error(`CS-Script setup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
