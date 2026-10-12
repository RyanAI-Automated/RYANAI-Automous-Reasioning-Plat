import { applyWorkspacePatch } from "../utils/workspacePatch.js";

export interface PatchRequest {
  filePath: string;
  patchContent: string;
  testScript?: string;
}

export class SelfPatchSkill {
  /**
   * Stage and verify a candidate before atomically promoting its original bytes.
   * Targets the current working directory. Returns {@link applyWorkspacePatch} statuses,
   * including failures; patchContent
   * is the complete replacement text and testScript is optional JavaScript verification.
   */
  public static async applyAndVerifyPatch(request: PatchRequest) {
    return applyWorkspacePatch(process.cwd(), request);
  }
}
