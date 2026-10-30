import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelfPatchSkill } from './selfPatchSkill.js';

const fetchMock = vi.fn<typeof fetch>();

function githubResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubEnv('RYANAI_GITHUB_TOKEN', 'fixture-scoped-token');
  vi.stubEnv('RYANAI_GITHUB_REPOSITORY', 'RyanAI-Automated/RYANAI-Automous-Reasioning-Plat');
  vi.stubEnv('RYANAI_GITHUB_BASE_BRANCH', 'main');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('production self-patch proposal', () => {
  it('creates a GitHub branch and PR without changing the running workspace', async () => {
    fetchMock
      .mockResolvedValueOnce(githubResponse({ object: { sha: 'base-sha' } }))
      .mockResolvedValueOnce(githubResponse({ tree: { sha: 'base-tree-sha' } }))
      .mockResolvedValueOnce(githubResponse({ truncated: false, tree: [{ path: 'src/agent/example.ts', mode: '100644', type: 'blob', sha: 'existing-file-sha' }] }))
      .mockResolvedValueOnce(githubResponse({ sha: 'blob-sha' }))
      .mockResolvedValueOnce(githubResponse({ sha: 'new-tree-sha' }))
      .mockResolvedValueOnce(githubResponse({ sha: 'candidate-commit-sha' }))
      .mockResolvedValueOnce(githubResponse({ ref: 'refs/heads/self-patch/test' }))
      .mockResolvedValueOnce(githubResponse({ html_url: 'https://github.com/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat/pull/900' }));

    const result = await SelfPatchSkill.proposePullRequest({
      filePath: 'src/agent/example.ts',
      patchContent: 'export const candidate = true;',
    });

    expect(result.status).toBe('proposed');
    expect(result.pullRequestUrl).toContain('/pull/900');
    expect(result.commitSha).toBe('candidate-commit-sha');
    expect(fetchMock).toHaveBeenCalledTimes(8);
    const firstRequest = fetchMock.mock.calls[0];
    expect(firstRequest[1]?.headers).toBeInstanceOf(Headers);
    expect((firstRequest[1]?.headers as Headers).get('Authorization')).toBe('Bearer fixture-scoped-token');
    const prRequest = fetchMock.mock.calls[7][1];
    expect(String(prRequest?.body)).toContain('has **not** been deployed or promoted');
  });

  it('rejects path traversal and protected files before any GitHub request', async () => {
    const traversal = await SelfPatchSkill.proposePullRequest({
      filePath: 'src/../../.env',
      patchContent: 'export const candidate = true;',
    });
    const protectedFile = await SelfPatchSkill.proposePullRequest({
      filePath: 'src/config/.env.production',
      patchContent: 'export const candidate = true;',
    });
    const secretFile = await SelfPatchSkill.proposePullRequest({
      filePath: 'src/config/secret.ts',
      patchContent: 'export const candidate = true;',
    });
    expect(traversal.status).toBe('rejected');
    expect(protectedFile.status).toBe('rejected');
    expect(secretFile.status).toBe('rejected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects symlink targets even when their path is in an allowed source directory', async () => {
    fetchMock
      .mockResolvedValueOnce(githubResponse({ object: { sha: 'base-sha' } }))
      .mockResolvedValueOnce(githubResponse({ tree: { sha: 'base-tree-sha' } }))
      .mockResolvedValueOnce(githubResponse({ truncated: false, tree: [{ path: 'src/agent/example.ts', mode: '120000', type: 'blob', sha: 'symlink-sha' }] }));
    const result = await SelfPatchSkill.proposePullRequest({
      filePath: 'src/agent/example.ts',
      patchContent: 'export const candidate = true;',
    });
    expect(result.status).toBe('rejected');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects credential-like patch content before contacting GitHub', async () => {
    const result = await SelfPatchSkill.proposePullRequest({
      filePath: 'src/agent/example.ts',
      patchContent: 'export const key = "sk-1234567890abcdefghijklmnop";',
    });
    expect(result.status).toBe('rejected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the scoped GitHub token or repository is missing', async () => {
    vi.stubEnv('RYANAI_GITHUB_TOKEN', '');
    const result = await SelfPatchSkill.proposePullRequest({
      filePath: 'src/agent/example.ts',
      patchContent: 'export const candidate = true;',
    });
    expect(result.status).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns conflict when GitHub rejects a concurrent or duplicate branch', async () => {
    fetchMock
      .mockResolvedValueOnce(githubResponse({ object: { sha: 'base-sha' } }))
      .mockResolvedValueOnce(githubResponse({ tree: { sha: 'base-tree-sha' } }))
      .mockResolvedValueOnce(githubResponse({ truncated: false, tree: [{ path: 'src/agent/example.ts', mode: '100644', type: 'blob', sha: 'existing-file-sha' }] }))
      .mockResolvedValueOnce(githubResponse({ sha: 'blob-sha' }))
      .mockResolvedValueOnce(githubResponse({ sha: 'new-tree-sha' }))
      .mockResolvedValueOnce(githubResponse({ sha: 'candidate-commit-sha' }))
      .mockResolvedValueOnce(githubResponse({ message: 'Reference already exists' }, 422));
    const result = await SelfPatchSkill.proposePullRequest({
      filePath: 'src/agent/example.ts',
      patchContent: 'export const candidate = true;',
    });
    expect(result.status).toBe('conflict');
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
});
