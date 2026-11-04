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
  it("wires the Quant Lab dashboard to the Python experiment API", () => {
    const app = readFileSync(path.join(root, "src/App.tsx"), "utf-8");
    const routes = JSON.parse(readFileSync(path.join(root, "app/routes.json"), "utf-8")) as {
      routes: Array<{ id: string; label: string; path: string }>;
    };
    expect(routes.routes).toContainEqual({ id: "quant", label: "Quant Lab", path: "/quant" });
    expect(app).toContain("{route === 'quant' && <QuantLabPage />}");
    for (const entrypoint of [
      "src/pages/QuantLab.tsx",
      "src/server/routes/quantRoutes.ts",
      "quant-engine/quant_engine.py",
    ]) {
      expect(existsSync(path.join(root, entrypoint)), entrypoint).toBe(true);
    }
  });

});