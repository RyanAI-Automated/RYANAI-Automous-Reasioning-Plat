import { applyWorkspacePatch } from "../utils/workspacePatch.js";

export interface PatchRequest {
  filePath: string;
  patchContent: string;
  testScript?: string;
}

export class SelfPatchSkill {
  /** Stage and verify a candidate before atomically promoting its original bytes. */
  public static async applyAndVerifyPatch(request: PatchRequest) {
    return applyWorkspacePatch(process.cwd(), request);
  }
}
