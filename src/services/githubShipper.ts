import { Octokit } from '@octokit/rest';

export interface FileToCommit {
  path: string;
  content: string;
}

export interface CommitAndPushOptions {
  owner: string;
  repo: string;
  branch: string;
  commitMessage: string;
  files: FileToCommit[];
  createBranchIfMissing?: boolean;
}

export interface CreatePullRequestOptions {
  owner: string;
  repo: string;
  title: string;
  body: string;
  headBranch: string;
  baseBranch: string;
}

export interface CreateReleaseOptions {
  owner: string;
  repo: string;
  tagName: string;
  releaseName: string;
  body: string;
  draft?: boolean;
  prerelease?: boolean;
}

export class GitHubShipper {
  private octokit: Octokit;

  constructor() {
    this.octokit = new Octokit({
      auth: process.env.GITHUB_PAT,
    });
  }

  /**
   * Create a GitHub commit for the supplied files and advance the branch without force.
   * By default, a missing branch is created from main. Return commit and tree SHAs;
   * API failures propagate and may leave a new branch or Git objects behind.
   */
  async commitAndPushFiles(opts: CommitAndPushOptions): Promise<{ commitSha: string; treeSha: string }> {
    const { owner, repo, branch, commitMessage, files, createBranchIfMissing = true } = opts;

    // 1. Get reference to target branch
    let masterRefSha: string;
    try {
      const { data: refData } = await this.octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });
      masterRefSha = refData.object.sha;
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 404 && createBranchIfMissing) {
        // Fallback: Get main/master SHA and create the branch
        const { data: mainRef } = await this.octokit.git.getRef({
          owner,
          repo,
          ref: 'heads/main',
        });
        masterRefSha = mainRef.object.sha;

        await this.octokit.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${branch}`,
          sha: masterRefSha,
        });
      } else {
        throw error;
      }
    }

    // 2. Fetch commit object to get base tree SHA
    const { data: currentCommit } = await this.octokit.git.getCommit({
      owner,
      repo,
      commit_sha: masterRefSha,
    });
    const baseTreeSha = currentCommit.tree.sha;

    // 3. Create Blobs for each file in parallel
    const treeItems = await Promise.all(
      files.map(async (file) => {
        const { data: blob } = await this.octokit.git.createBlob({
          owner,
          repo,
          content: Buffer.from(file.content).toString('base64'),
          encoding: 'base64',
        });

        return {
          path: file.path,
          mode: '100644' as const, // Standard file mode
          type: 'blob' as const,
          sha: blob.sha,
        };
      })
    );

    // 4. Construct new tree with base tree reference
    const { data: newTree } = await this.octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: treeItems,
    });

    // 5. Create new Commit
    const { data: newCommit } = await this.octokit.git.createCommit({
      owner,
      repo,
      message: commitMessage,
      tree: newTree.sha,
      parents: [masterRefSha],
    });

    // 6. Move target branch pointer to new Commit
    await this.octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
      force: false,
    });

    return {
      commitSha: newCommit.sha,
      treeSha: newTree.sha,
    };
  }

  /**
   * Create Pull Request when protected main branch blocks direct commits
   */
  async createPullRequest(opts: CreatePullRequestOptions) {
    const { owner, repo, title, body, headBranch, baseBranch } = opts;

    const { data: pr } = await this.octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head: headBranch,
      base: baseBranch,
    });

    return {
      prNumber: pr.number,
      htmlUrl: pr.html_url,
      state: pr.state,
    };
  }

  /**
   * Publish a Tagged Release in GitHub
   */
  async createRelease(opts: CreateReleaseOptions) {
    const { owner, repo, tagName, releaseName, body, draft = false, prerelease = false } = opts;

    const { data: release } = await this.octokit.repos.createRelease({
      owner,
      repo,
      tag_name: tagName,
      name: releaseName,
      body,
      draft,
      prerelease,
    });

    return {
      releaseId: release.id,
      htmlUrl: release.html_url,
      tagName: release.tag_name,
    };
  }
}