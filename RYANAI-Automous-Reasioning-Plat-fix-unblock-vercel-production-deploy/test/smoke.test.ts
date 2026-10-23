// File path: ./test/smoke.test.ts

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("RyanAI platform smoke checks", () => {
  it("contains the frontend and API entrypoints", () => {
    for (const entrypoint of ["index.html", "src/main.tsx", "src/App.tsx", "src/server/launcher.ts"]) {
      expect(existsSync(path.join(root, entrypoint)), `${entrypoint} should exist`).toBe(true);
    }
  });

  it("provides a root mount for the React application", () => {
    const html = readFileSync(path.join(root, "index.html"), "utf-8");
    expect(html).toContain('id="root"');
  });
});