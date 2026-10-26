import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';

const MAX_READ_BYTES = 100_000;
const MAX_LIST_ENTRIES = 200;

// Never expose version-control data, dependencies, env files, or key files.
const BLOCKED_PATH =
  /(^|[\\/])(\.git|node_modules|\.ssh|\.aws)([\\/]|$)|(^|[\\/])\.env[^\\/]*$|\.(pem|key|p12|pfx)$/i;

/**
 * Resolve a path inside AGENT_WORKSPACE_ROOT. Only an admin may use these
 * tools, and the real path (after symlinks) must stay inside the root.
 */
async function resolveInWorkspace(relativePath: string, config?: RunnableConfig) {
  if (config?.configurable?.role !== 'admin') {
    throw new Error('Workspace tools are for administrators only.');
  }
  const rootSetting = process.env.AGENT_WORKSPACE_ROOT;
  if (!rootSetting) {
    throw new Error('AGENT_WORKSPACE_ROOT is not set, so workspace tools are off.');
  }
  const root = await fs.realpath(rootSetting);
  const target = await fs.realpath(path.resolve(root, relativePath));
  const relative = path.relative(root, target);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('The path is outside the workspace.');
  }
  if (BLOCKED_PATH.test(relative)) {
    throw new Error('The path is blocked.');
  }
  return target;
}

export const listWorkspaceFilesTool = tool(
  async ({ path: dir }, config) => {
    const target = await resolveInWorkspace(dir, config);
    const entries = await fs.readdir(target, { withFileTypes: true });
    const visible = entries
      .filter((entry) => !BLOCKED_PATH.test(entry.name))
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
    const target = await resolveInWorkspace(file, config);
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

export const workspaceTools = [listWorkspaceFilesTool, readWorkspaceFileTool];
