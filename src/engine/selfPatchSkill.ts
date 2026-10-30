import { createHash, randomUUID } from 'node:crypto';
import { applyWorkspacePatch } from '../utils/workspacePatch.js';

export interface PatchRequest {
  filePath: string;
  patchContent: string;
}

export interface PatchProposalResult {
  status: 'proposed' | 'rejected' | 'conflict' | 'unavailable';
  message?: string;
  error?: string;
  pullRequestUrl?: string;
  branch?: string;
  commitSha?: string;
  filePath?: string;
}

class GitHubApiError extends Error {
  constructor(public readonly status: number) {
    super(`GitHub API request failed with HTTP ${status}.`);
    this.name = 'GitHubApiError';
  }
}

const MAX_PATCH_BYTES = 200_000;
const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{12,}|nvapi-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._~+\/-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i;
const ALLOWED_PREFIXES = ['src/', 'mcp-server/', 'scripts/'];

function validatePatch(request: PatchRequest): string | null {
  if (!request || typeof request.filePath !== 'string' || typeof request.patchContent !== 'string') {
    return 'Patch request must include a file path and complete file content.';
  }
  const filePath = request.filePath.trim();
  if (
    !filePath ||
    filePath.length > 500 ||
    !/^[A-Za-z0-9._/-]+$/.test(filePath) ||
    filePath.startsWith('/') ||
    filePath.includes('\\') ||
    filePath.includes('\0') ||
    filePath.split('/').some((part) => !part || part === '.' || part === '..') ||
    !ALLOWED_PREFIXES.some((prefix) => filePath.startsWith(prefix)) ||
    /(?:^|\/)(?:\.env(?:\.|$)|secrets?|credentials?)(?:\/|$)/i.test(filePath) ||
    /(?:\.pem|\.key|\.p12|\.pfx|id_rsa|id_ed25519)$/i.test(filePath)
  ) return 'Patch path is outside the permitted source directories or targets a protected file.';
  if (typeof request.patchContent !== 'string' || request.patchContent.length === 0 || Buffer.byteLength(request.patchContent) > MAX_PATCH_BYTES) {
    return 'Patch content must contain 1–200,000 bytes.';
  }
  if (SECRET_PATTERN.test(request.patchContent)) {
    return 'Patch content appears to contain a credential or private key and was rejected.';
  }
  return null;
}

async function githubRequest(token: string, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-GitHub-Api-Version', '2022-11-28');
  headers.set('Content-Type', 'application/json');
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    signal: AbortSignal.timeout(20_000),
    headers,
  });
  if (!response.ok) throw new GitHubApiError(response.status);
  return await response.json() as Record<string, unknown>;
}

/**
 * Production self-patching creates a CI-verified GitHub PR instead of writing
 * directly into the running container. This works on managed hosts without
 * Docker socket access and preserves the normal review/deploy pipeline.
 */
export class SelfPatchSkill {
  /** Propose a bounded source-file change on an isolated branch. */
  public static async proposePullRequest(request: PatchRequest): Promise<PatchProposalResult> {
    const invalid = validatePatch(request);
    if (invalid) return { status: 'rejected', error: invalid };

    const token = process.env.RYANAI_GITHUB_TOKEN?.trim();
    const repository = process.env.RYANAI_GITHUB_REPOSITORY?.trim();
    const baseBranch = process.env.RYANAI_GITHUB_BASE_BRANCH?.trim() || 'main';
    if (!token || !repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
      return {
        status: 'unavailable',
        error: 'GitHub patch integration is not configured. Set a repository-scoped RYANAI_GITHUB_TOKEN and RYANAI_GITHUB_REPOSITORY.',
      };
    }
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(baseBranch) || baseBranch.startsWith('/') || baseBranch.includes('..')) {
      return { status: 'rejected', error: 'Configured GitHub base branch is invalid.' };
    }

    const [owner, name] = repository.split('/');
    const encodedPath = request.filePath.trim().split('/').map(encodeURIComponent).join('/');
    let branch = '';
    let branchCreated = false;
    try {
      const baseRef = await githubRequest(token, `/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
      const baseSha = (baseRef.object as Record<string, unknown> | undefined)?.sha;
      if (typeof baseSha !== 'string') throw new Error('GitHub base branch reference is invalid.');

      const currentFile = await githubRequest(token, `/repos/${owner}/${name}/contents/${encodedPath}?ref=${encodeURIComponent(baseSha)}`);
      if (typeof currentFile.sha !== 'string' || currentFile.type !== 'file') {
        return { status: 'rejected', error: 'Self-patching is limited to existing tracked source files.' };
      }

      const baseCommit = await githubRequest(token, `/repos/${owner}/${name}/git/commits/${baseSha}`);
      const baseTreeSha = (baseCommit.tree as Record<string, unknown> | undefined)?.sha;
      if (typeof baseTreeSha !== 'string') throw new Error('GitHub base commit tree is unavailable.');

      const blob = await githubRequest(token, `/repos/${owner}/${name}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: request.patchContent, encoding: 'utf-8' }),
      });
      if (typeof blob.sha !== 'string') throw new Error('GitHub did not create the patch blob.');

      const tree = await githubRequest(token, `/repos/${owner}/${name}/git/trees`, {
        method: 'POST',
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: [{ path: request.filePath.trim(), mode: '100644', type: 'blob', sha: blob.sha }],
        }),
      });
      if (typeof tree.sha !== 'string') throw new Error('GitHub did not create the patch tree.');

      const commit = await githubRequest(token, `/repos/${owner}/${name}/git/commits`, {
        method: 'POST',
        body: JSON.stringify({
          message: `self-patch: update ${request.filePath.trim()}`,
          tree: tree.sha,
          parents: [baseSha],
        }),
      });
      if (typeof commit.sha !== 'string') throw new Error('GitHub did not create the patch commit.');

      const fingerprint = createHash('sha256').update(`${request.filePath}\n${request.patchContent}\n${randomUUID()}`).digest('hex').slice(0, 12);
      branch = `self-patch/${Date.now()}-${fingerprint}`;
      await githubRequest(token, `/repos/${owner}/${name}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
      });
      branchCreated = true;

      const pullRequest = await githubRequest(token, `/repos/${owner}/${name}/pulls`, {
        method: 'POST',
        body: JSON.stringify({
          title: `Self-patch: update ${request.filePath.trim()}`,
          head: branch,
          base: baseBranch,
          body: [
            '## RyanAI self-patch proposal',
            '',
            'This candidate was submitted by the administrator-authorized self-patch service.',
            'It has **not** been deployed or promoted.',
            '',
            `- File: \`${request.filePath.trim()}\``,
            `- Base commit: \`${baseSha}\``,
            `- Candidate commit: \`${commit.sha}\``,
            '',
            'Required CI, security scanning, and repository branch-protection rules must pass before merge.',
          ].join('\n'),
        }),
      });
      if (typeof pullRequest.html_url !== 'string') throw new Error('GitHub did not return the created pull request URL.');

      return {
        status: 'proposed',
        message: 'Patch proposal created. Repository CI and branch protection must pass before it can be merged or deployed.',
        pullRequestUrl: pullRequest.html_url,
        branch,
        commitSha: commit.sha,
        filePath: request.filePath.trim(),
      };
    } catch (error: unknown) {
      if (branchCreated && branch) {
        try {
          await githubRequest(token, `/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'DELETE' });
        } catch {
          // Orphan branch cleanup is best effort; the failure remains visible below.
        }
      }
      if (error instanceof GitHubApiError && (error.status === 409 || error.status === 422)) {
        return { status: 'conflict', error: 'GitHub rejected the patch due to a branch or base-revision conflict. Refresh and submit a new proposal.' };
      }
      return {
        status: 'unavailable',
        error: error instanceof GitHubApiError
          ? `GitHub patch service returned HTTP ${error.status}; no patch was deployed.`
          : error instanceof Error
            ? error.message
            : 'GitHub patch service is unavailable; no patch was deployed.',
      };
    }
  }

  /** Local-only verified patch path for developer workspaces with Docker available. */
  public static async applyAndVerifyPatch(request: PatchRequest) {
    return applyWorkspacePatch(process.cwd(), request);
  }
}
