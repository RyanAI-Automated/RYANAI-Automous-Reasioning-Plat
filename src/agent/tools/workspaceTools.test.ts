import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listWorkspaceFilesTool,
  readWorkspaceFileTool,
  writeWorkspaceFileTool,
} from './workspaceTools.js';

const admin = { configurable: { role: 'admin' } };
let base: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'ryanai-workspace-'));
  const root = path.join(base, 'root');
  await mkdir(root);
  await writeFile(path.join(root, 'hello.txt'), 'hello');
  await writeFile(path.join(root, '.env'), 'SECRET=1');
  await writeFile(path.join(base, 'outside.txt'), 'outside');
  await symlink(path.join(base, 'outside.txt'), path.join(root, 'link.txt'));
  process.env.AGENT_WORKSPACE_ROOT = root;
});

afterEach(async () => {
  delete process.env.AGENT_WORKSPACE_ROOT;
  delete process.env.AGENT_WORKSPACE_WRITE;
  await rm(base, { recursive: true, force: true });
});

describe('workspace tools', () => {
  it('reads a file inside the workspace', async () => {
    const result = await readWorkspaceFileTool.invoke({ path: 'hello.txt' }, admin);
    expect(JSON.parse(result)).toEqual({ path: 'hello.txt', content: 'hello', truncated: false });
  });

  it('hides blocked files from listings', async () => {
    const result = await listWorkspaceFilesTool.invoke({ path: '.' }, admin);
    const { entries } = JSON.parse(result);
    expect(entries).toContain('hello.txt');
    expect(entries).not.toContain('.env');
  });

  it('refuses a path that leaves the workspace', async () => {
    await expect(
      readWorkspaceFileTool.invoke({ path: '../outside.txt' }, admin),
    ).rejects.toThrow(/outside the workspace/);
  });

  it('refuses a symlink that points outside the workspace', async () => {
    await expect(
      readWorkspaceFileTool.invoke({ path: 'link.txt' }, admin),
    ).rejects.toThrow(/outside the workspace/);
  });

  it('refuses to read an env file', async () => {
    await expect(
      readWorkspaceFileTool.invoke({ path: '.env' }, admin),
    ).rejects.toThrow(/blocked/);
  });

  it('refuses callers that are not administrators', async () => {
    await expect(
      readWorkspaceFileTool.invoke({ path: 'hello.txt' }, { configurable: { role: 'user' } }),
    ).rejects.toThrow(/administrators only/);
  });

  it('is off when no workspace root is set', async () => {
    delete process.env.AGENT_WORKSPACE_ROOT;
    await expect(
      listWorkspaceFilesTool.invoke({ path: '.' }, admin),
    ).rejects.toThrow(/AGENT_WORKSPACE_ROOT/);
  });
});

describe('write_workspace_file', () => {
  it('is off unless AGENT_WORKSPACE_WRITE is true', async () => {
    await expect(
      writeWorkspaceFileTool.invoke({ path: 'new.txt', content: 'x' }, admin),
    ).rejects.toThrow(/AGENT_WORKSPACE_WRITE/);
    await expect(stat(path.join(base, 'root', 'new.txt'))).rejects.toThrow();
  });

  it('writes a file and creates missing folders', async () => {
    process.env.AGENT_WORKSPACE_WRITE = 'true';
    const result = await writeWorkspaceFileTool.invoke(
      { path: 'src/new/feature.ts', content: 'export const a = 1;\n' },
      admin,
    );
    expect(JSON.parse(result)).toEqual({ path: 'src/new/feature.ts', bytes: 20 });
    expect(await readFile(path.join(base, 'root', 'src', 'new', 'feature.ts'), 'utf8')).toBe(
      'export const a = 1;\n',
    );
  });

  it('replaces an existing file', async () => {
    process.env.AGENT_WORKSPACE_WRITE = 'true';
    await writeWorkspaceFileTool.invoke({ path: 'hello.txt', content: 'changed' }, admin);
    expect(await readFile(path.join(base, 'root', 'hello.txt'), 'utf8')).toBe('changed');
  });

  it('refuses blocked paths, symbolic links, and paths outside the workspace', async () => {
    process.env.AGENT_WORKSPACE_WRITE = 'true';
    const write = (file: string) =>
      writeWorkspaceFileTool.invoke({ path: file, content: 'x' }, admin);
    await expect(write('.env')).rejects.toThrow(/blocked/);
    await expect(write('.github/workflows/ci.yml')).rejects.toThrow(/blocked/);
    await expect(write('link.txt')).rejects.toThrow(/symbolic link/);
    await expect(write('../outside.txt')).rejects.toThrow(/outside the workspace/);
    expect(await readFile(path.join(base, 'outside.txt'), 'utf8')).toBe('outside');
  });

  it('refuses callers that are not administrators, even when writing is on', async () => {
    process.env.AGENT_WORKSPACE_WRITE = 'true';
    await expect(
      writeWorkspaceFileTool.invoke(
        { path: 'new.txt', content: 'x' },
        { configurable: { role: 'user' } },
      ),
    ).rejects.toThrow(/administrators only/);
  });
});
