import { describe, expect, it } from 'vitest';
import { patchService } from './patchService.js';
import { PatchStatus, PatchTargetType } from '../types/patch.js';

describe('legacy patch service', () => {
  it('fails closed instead of writing directly to the workspace', async () => {
    const result = await patchService.applyPatch({
      targetType: PatchTargetType.AGENT_INSTANCE,
      targetId: 'src/agent/example.ts',
      version: '1',
      operations: [{ op: 'replace', path: 'unsafe', value: 'replacement' }],
    });
    expect(result.status).toBe(PatchStatus.FAILED);
    expect(result.error).toContain('isolated self-patch verification pipeline');
  });
});
