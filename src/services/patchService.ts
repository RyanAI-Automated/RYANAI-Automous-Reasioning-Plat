import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PatchRequest,
  PatchResult,
  PatchStatus,
} from '../types/patch.js';

export const patchService = {
  async applyPatch(request: PatchRequest): Promise<PatchResult> {
    const id = randomUUID();
    const targetPath = request.targetId || '';
    if (!targetPath || path.isAbsolute(targetPath) || targetPath.includes('..')) {
      return {
        id,
        targetType: request.targetType,
        targetId: request.targetId,
        status: PatchStatus.FAILED,
        version: request.version,
        appliedAt: new Date().toISOString(),
        error: 'A safe relative targetId is required.',
      };
    }

    try {
      const filename = path.resolve(process.cwd(), targetPath);
      let content = await readFile(filename, 'utf8');
      for (const operation of request.operations) {
        if (operation.op !== 'replace' || typeof operation.value !== 'string') {
          throw new Error('Only string replace operations are supported.');
        }
        content = content.replace(operation.path, operation.value);
      }
      await writeFile(filename, content, 'utf8');
      return {
        id,
        targetType: request.targetType,
        targetId: request.targetId,
        status: PatchStatus.SUCCESS,
        version: request.version,
        appliedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        id,
        targetType: request.targetType,
        targetId: request.targetId,
        status: PatchStatus.FAILED,
        version: request.version,
        appliedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
