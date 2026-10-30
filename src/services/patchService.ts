import {
  PatchRequest,
  PatchResult,
  PatchStatus,
} from '../types/patch.js';

/**
 * Legacy operation-based patch requests are intentionally disabled.
 *
 * Direct filesystem replacement bypassed staging, the digest-pinned verifier,
 * Git revision checks, symlink defenses and atomic promotion. All code changes
 * must use SelfPatchSkill.applyAndVerifyPatch instead.
 */
export const patchService = {
  async applyPatch(request: PatchRequest): Promise<PatchResult> {
    return {
      id: 'disabled-legacy-patch-path',
      targetType: request.targetType,
      targetId: request.targetId,
      status: PatchStatus.FAILED,
      version: request.version,
      appliedAt: new Date().toISOString(),
      error: 'Legacy direct-write patching is disabled. Use the isolated self-patch verification pipeline.',
    };
  },
};
