import { promises as fs } from 'node:fs';
import path from 'node:path';

// Never expose version-control data, dependencies, env files, or key files.
const SENSITIVE =
  /(^|[\\/])(\.git|node_modules|\.ssh|\.aws)([\\/]|$)|(^|[\\/])\.env[^\\/]*$|\.(pem|key|p12|pfx)$/i;
// Workflow files run with repository secrets, so the agent must not write them.
const CI_CONFIG = /(^|[\\/])\.github([\\/]|$)/i;

export const isReadBlocked = (relativePath: string) => SENSITIVE.test(relativePath);
const isWriteBlocked = (relativePath: string) =>
  SENSITIVE.test(relativePath) || CI_CONFIG.test(relativePath);

function isInside(root: string, target: string) {
  const relative = path.relative(root, target);
  return !(
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

/** The real path of the deepest ancestor that exists, or null when none can be read. */
async function realPathOfExistingAncestor(start: string): Promise<string | null> {
  let current = start;
  for (;;) {
    try {
      return await fs.realpath(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

/**
 * Resolve an existing path for reading. The real path (after symbolic links)
 * must stay inside the workspace root, and it must not be a blocked path.
 */
export async function resolveReadable(rootSetting: string, relativePath: string) {
  const root = await fs.realpath(rootSetting);
  const target = await fs.realpath(path.resolve(root, relativePath));
  if (!isInside(root, target)) {
    throw new Error('The path is outside the workspace.');
  }
  if (isReadBlocked(path.relative(root, target))) {
    throw new Error('The path is blocked.');
  }
  return target;
}

/**
 * Resolve a path for writing. The file may not exist yet. The deepest existing
 * parent must resolve inside the root, the file must not be a symbolic link,
 * and the path must not be blocked.
 */
export async function resolveWritable(rootSetting: string, relativePath: string) {
  const root = await fs.realpath(rootSetting);
  const target = path.resolve(root, relativePath);
  const lexical = path.relative(root, target);
  if (lexical === '' || !isInside(root, target)) {
    throw new Error('The path is outside the workspace.');
  }
  if (isWriteBlocked(lexical)) {
    throw new Error('The path is blocked.');
  }

  const ancestor = await realPathOfExistingAncestor(path.dirname(target));
  if (!ancestor || !isInside(root, ancestor)) {
    throw new Error('The path is outside the workspace.');
  }

  try {
    const info = await fs.lstat(target);
    if (info.isSymbolicLink()) {
      throw new Error('The path is a symbolic link. Writing through it is not allowed.');
    }
    if (!info.isFile()) {
      throw new Error('The path is not a file.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return target;
}
