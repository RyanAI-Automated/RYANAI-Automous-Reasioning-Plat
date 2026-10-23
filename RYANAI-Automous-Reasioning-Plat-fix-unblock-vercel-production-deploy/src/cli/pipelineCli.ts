#!/usr/bin/env node

import { PipelineOrchestrator } from "../orchestrator/pipelineOrchestrator.js";
import fs from "node:fs";
import path from "node:path";

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const runAll = args.includes("--all");
  const shouldShip = args.includes("--ship");
  const strictTranscend = args.includes("--strict");

  console.log(`
┌────────────────────────────────────────────────────────┐
│ RYAN_AI // PIPELINE CLI ORCHESTRATOR                   │
└────────────────────────────────────────────────────────┘
`);

  if (!runAll) {
    console.log("Usage: ryan pipeline --all [--ship] [--strict]");
    process.exit(0);
  }

  try {
    const orchestrator = new PipelineOrchestrator();

    const sampleFilePath = path.join(process.cwd(), "src/index.ts");
    const sampleContent = fs.existsSync(sampleFilePath)
      ? fs.readFileSync(sampleFilePath, "utf-8")
      : '// RyanAI Generated Codebase\nconsole.log("Ryan Engine Online");';

    const result = await orchestrator.runPipeline({
      projectName: "Ryan-app",
      branch: "main",
      commitMessage: `build(ryan): automated 5-phase execution [${new Date().toISOString()}]`,
      filesToShip: [
        {
          path: "src/index.ts",
          content: sampleContent,
        },
      ],
      author: "Ntsiyeni Ganyane",
      autoShip: shouldShip,
      transcendStrict: strictTranscend,
    });

    console.log(`\n=================== RUN RESULTS ===================`);
    console.log(`Run ID:         ${result.runId}`);
    console.log(`Overall Status: ${result.overallStatus}`);
    console.log(`Duration:       ${(result.totalDurationMs / 1000).toFixed(2)}s`);
    console.log(`GitHub Commit:  ${result.githubCommitSha || "N/A"}`);
    console.log(`Dispatch Sent:  ${result.dispatchReportSent}`);
    console.log(`====================================================\n`);

    result.phases.forEach((p) => {
      const symbol = p.status === "PASSED" ? "✓" : "✗";
      console.log(`[${symbol}] Phase ${p.phase}: ${p.name} (${p.durationMs}ms)`);
      if (p.error) console.error(`    Error: ${p.error}`);
    });

    if (result.overallStatus !== "SUCCESS") {
      process.exit(1);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[Fatal CLI Error]: ${message}`);
    process.exit(1);
  }
}

runCli();