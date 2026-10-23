// File path: ./test/gateway.test.ts
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

describe("RyanAI gateway entrypoints", () => {
  it("contains the application shell and API launcher", () => {
    expect(existsSync(path.resolve("src/App.tsx"))).toBe(true);
    expect(existsSync(path.resolve("src/server/launcher.ts"))).toBe(true);
  });
});