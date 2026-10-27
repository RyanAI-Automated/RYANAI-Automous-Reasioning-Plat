import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { isReadBlocked, resolveReadable, resolveWritable } from './workspacePaths.js';

const MAX_READ_BYTES = 100_000;
const MAX_WRITE_CHARS = 200_000;
const MAX_LIST_ENTRIES = 200;

/** Only an administrator may use the workspace tools, and the root must be set. */
function workspaceRoot(config?: RunnableConfig) {
  if (config?.configurable?.role !== 'admin') {
    throw new Error('Workspace tools are for administrators only.');
  }
  const root = process.env.AGENT_WORKSPACE_ROOT;
  if (!root) {
    throw new Error('AGENT_WORKSPACE_ROOT is not set, so workspace tools are off.');
  }
  return root;
}

export const listWorkspaceFilesTool = tool(
  async ({ path: dir }, config) => {
    const target = await resolveReadable(workspaceRoot(config), dir);
    const entries = await fs.readdir(target, { withFileTypes: true });
    const visible = entries
      .filter((entry) => !isReadBlocked(entry.name))
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    return JSON.stringify({
      path: dir,
      entries: visible.slice(0, MAX_LIST_ENTRIES),
      truncated: visible.length > MAX_LIST_ENTRIES,
    });
  },
  {
    name: 'list_workspace_files',
    description: 'Lists the files and folders in a directory of the code workspace.',
    schema: z.object({
      path: z.string().default('.').describe('Directory path relative to the workspace root'),
    }),
  },
);

export const readWorkspaceFileTool = tool(
  async ({ path: file }, config) => {
    const target = await resolveReadable(workspaceRoot(config), file);
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error('The path is not a file.');
    const handle = await fs.open(target, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return JSON.stringify({
        path: file,
        content: buffer.subarray(0, bytesRead).toString('utf8'),
        truncated: stat.size > MAX_READ_BYTES,
      });
    } finally {
      await handle.close();
    }
  },
  {
    name: 'read_workspace_file',
    description: 'Reads a text file from the code workspace. Files over 100 KB are cut off.',
    schema: z.object({
      path: z.string().min(1).describe('File path relative to the workspace root'),
    }),
  },
);

export const writeWorkspaceFileTool = tool(
  async ({ path: file, content }, config) => {
    const root = workspaceRoot(config);
    if (process.env.AGENT_WORKSPACE_WRITE !== 'true') {
      throw new Error('Writing is off. Set AGENT_WORKSPACE_WRITE=true to allow it.');
    }
    const target = await resolveWritable(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    return JSON.stringify({ path: file, bytes: Buffer.byteLength(content, 'utf8') });
  },
  {
    name: 'write_workspace_file',
    description:
      'Creates or replaces a text file in the code workspace. Missing folders are created. Cannot write to .git, .github, env files, or key files.',
    schema: z.object({
      path: z.string().min(1).describe('File path relative to the workspace root'),
      content: z.string().max(MAX_WRITE_CHARS).describe('The full new content of the file'),
    }),
  },
);

export const workspaceTools = [
  listWorkspaceFilesTool,
  readWorkspaceFileTool,
  writeWorkspaceFileTool,
];
