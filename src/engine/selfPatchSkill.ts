import { applyWorkspacePatch } from "../utils/workspacePatch.js";

class PatchMutex {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve(() => this.release());
      });
    });
  }

  private release() {
    const next = this.queue.shift();
    if (next) next();
    else this.locked = false;
  }
}

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
