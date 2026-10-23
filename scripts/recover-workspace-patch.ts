import { recoverWorkspacePatch } from "../src/utils/workspacePatch.js";

if (process.argv.length !== 4 || process.argv[2] !== "--confirm-quiescent") {
  console.error(
    "Stop all workspace writers, then run: tsx scripts/recover-workspace-patch.ts --confirm-quiescent /absolute/workspace",
  );
  process.exitCode = 1;
} else {
  try {
    console.log(await recoverWorkspacePatch(process.argv[3], true));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
