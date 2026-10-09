import assert from "node:assert/strict";
import { test } from "node:test";
import { setupCsScript } from "./setup-cs-script.mjs";

function fixture({
  sdks = "10.0.100 [/usr/share/dotnet/sdk]\n",
  installed = "",
  failAt,
} = {}) {
  const calls = [];
  const logs = [];
  return {
    calls,
    logs,
    run: () =>
      setupCsScript(
        (args) => {
          calls.push(args);
          if (calls.length === failAt) throw new Error("dotnet failed");
          if (args[0] === "--list-sdks") return sdks;
          if (args[1] === "list") return installed;
          return "";
        },
        (message) => logs.push(message),
      ),
  };
}

test("installs both missing tools after checking the SDK", () => {
  const setup = fixture();
  setup.run();
  assert.deepEqual(setup.calls, [
    ["--list-sdks"],
    ["tool", "list", "--global"],
    ["tool", "install", "--global", "cs-script.cli"],
    ["tool", "install", "--global", "cs-syntaxer"],
  ]);
  assert.match(setup.logs.at(-1), /Detect and integrate CS-Script/);
});

test("updates installed tools and installs only missing ones", () => {
  for (const installed of [
    "Package Id      Version      Commands\r\n-----------------------------------\r\ncs-script.cli   4.14.0       css\r\n",
    "CS-SCRIPT.CLI 4.14.0 css\ncs-syntaxer 2.0.0 syntaxer\n",
  ]) {
    const setup = fixture({ installed });
    setup.run();
    assert.deepEqual(setup.calls[2], [
      "tool",
      "update",
      "--global",
      "cs-script.cli",
    ]);
    assert.deepEqual(setup.calls[3], [
      "tool",
      installed.includes("cs-syntaxer") ? "update" : "install",
      "--global",
      "cs-syntaxer",
    ]);
  }
});

test("requires an SDK before attempting to modify tools", () => {
  const setup = fixture({ sdks: " \r\n" });
  assert.throws(setup.run, /No .NET SDK was found/);
  assert.equal(setup.calls.length, 1);
});

test("stops after SDK, inventory, or tool failures without reporting success", () => {
  for (const failAt of [1, 2, 3, 4]) {
    const setup = fixture({ failAt });
    assert.throws(setup.run, /dotnet failed/);
    assert.equal(setup.calls.length, failAt);
    assert.ok(
      setup.logs.every((message) => !message.includes("tools are ready")),
    );
  }
});
