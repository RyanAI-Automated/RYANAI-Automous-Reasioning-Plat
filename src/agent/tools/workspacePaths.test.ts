import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveReadable, resolveWritable } from './workspacePaths.js';

let base: string;
let root: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'ryanai-paths-'));
  root = path.join(base, 'root');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'a.ts'), 'a');
  await writeFile(path.join(root, '.env'), 'SECRET=1');
  await mkdir(path.join(base, 'outside'));
  await writeFile(path.join(base, 'outside', 'x.txt'), 'x');
  await symlink(path.join(base, 'outside', 'x.txt'), path.join(root, 'link.txt'));
  await symlink(path.join(base, 'outside'), path.join(root, 'linkdir'));
});

afterEach(() => rm(base, { recursive: true, force: true }));

describe('resolveReadable', () => {
  it('resolves a file inside the root', async () => {
    expect(await resolveReadable(root, 'src/a.ts')).toBe(
      path.join(await realRoot(), 'src', 'a.ts'),
    );
  });

  it('refuses paths outside the root, symbolic links out, and blocked files', async () => {
    await expect(resolveReadable(root, '../outside/x.txt')).rejects.toThrow(/outside/);
    await expect(resolveReadable(root, 'link.txt')).rejects.toThrow(/outside/);
    await expect(resolveReadable(root, '.env')).rejects.toThrow(/blocked/);
  });
});

describe('resolveWritable', () => {
  it('allows a new file in a folder that does not exist yet, and creates nothing', async () => {
    const target = await resolveWritable(root, 'src/new/deep/b.ts');
    expect(target).toBe(path.join(await realRoot(), 'src', 'new', 'deep', 'b.ts'));
    await expect(stat(path.join(root, 'src', 'new'))).rejects.toThrow();
  });

  it('allows replacing an existing file', async () => {
    expect(await resolveWritable(root, 'src/a.ts')).toBe(
      path.join(await realRoot(), 'src', 'a.ts'),
    );
  });

  it('refuses paths outside the root and the root itself', async () => {
    await expect(resolveWritable(root, '../outside/y.txt')).rejects.toThrow(/outside/);
    await expect(resolveWritable(root, '/etc/passwd')).rejects.toThrow(/outside/);
    await expect(resolveWritable(root, '.')).rejects.toThrow(/outside/);
  });

  it('refuses to write through a symbolic link to a file', async () => {
    await expect(resolveWritable(root, 'link.txt')).rejects.toThrow(/symbolic link/);
  });

  it('refuses a new file under a symbolic link to a folder outside the root', async () => {
    await expect(resolveWritable(root, 'linkdir/new.txt')).rejects.toThrow(/outside/);
    await expect(resolveWritable(root, 'linkdir/sub/new.txt')).rejects.toThrow(/outside/);
  });

  it('refuses blocked paths, including workflow files', async () => {
    await expect(resolveWritable(root, '.env')).rejects.toThrow(/blocked/);
    await expect(resolveWritable(root, '.env.local')).rejects.toThrow(/blocked/);
    await expect(resolveWritable(root, '.git/config')).rejects.toThrow(/blocked/);
    await expect(resolveWritable(root, '.github/workflows/ci.yml')).rejects.toThrow(/blocked/);
    await expect(resolveWritable(root, 'keys/server.pem')).rejects.toThrow(/blocked/);
  });

  it('refuses a folder as the target', async () => {
    await expect(resolveWritable(root, 'src')).rejects.toThrow(/not a file/);
  });
});

async function realRoot() {
  const { realpath } = await import('node:fs/promises');
  return realpath(root);
}
