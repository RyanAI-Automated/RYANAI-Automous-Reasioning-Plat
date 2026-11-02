// src/tools/fileShellTools.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as fs from 'fs/promises';
import * as path from 'path';
const WORKSPACE_ROOT = process.env.RYANAI_WORKSPACE_ROOT ?? process.cwd();
const SENSITIVE_FILE = /(^|[\\\\/])(\\.env(?:\\.|$)|id_rsa|id_ed25519|.*\\.(?:pem|key|p12|pfx)|secrets?)([\\\\/]|$)/i;

/**
 * Read UTF-8 file contents under the configured workspace path.
 * Return an access-denied or failure message when the prefix check or file read fails.
 */
export const readFileTool = tool(
  async ({ filePath }) => {
    try {
      if (!filePath || path.isAbsolute(filePath) || SENSITIVE_FILE.test(filePath)) {
        return "Access denied: Absolute paths and sensitive credential files are not readable by agents.";
      }
      const root = await fs.realpath(WORKSPACE_ROOT);
      const safePath = await fs.realpath(path.resolve(root, filePath));
      const relative = path.relative(root, safePath);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        return "Access denied: Path is outside the RyanAI workspace boundary.";
      }
      if (SENSITIVE_FILE.test(relative)) {
        return "Access denied: Sensitive credential files are not readable by agents.";
      }
      const content = await fs.readFile(safePath, 'utf-8');
      return `File Content (${filePath}):\n${content}`;
    } catch (error: unknown) {
      return `Failed to read file: ${(error instanceof Error ? error.message : String(error))}`;
    }
  },
  {
    name: "read_workspace_file",
    description: "Reads a file within the RyanAI workspace.",
    schema: z.object({
      filePath: z.string().describe("Relative path to the file from workspace root."),
    }),
  }
);

/**
 * Gen-X hardening: arbitrary shell execution is disabled. Agent workflows must use
 * narrowly scoped, purpose-built tools with their own authorization and sandboxing.
 */
export const executeShellTool = tool(
  async () => "Execution blocked by Gen-X: arbitrary shell and command execution are disabled for agents.",
  {
    name: "execute_shell_command",
    description: "Disabled by Gen-X zero-trust security policy. Use approved purpose-built tools instead.",
    schema: z.object({
      command: z.string().max(1).optional().describe("No shell command is accepted."),
    }),
  }
);

export const fileShellTools = [readFileTool, executeShellTool];