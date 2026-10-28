import stackTemplate from '../../../stacks/ryanai.stack.json' with { type: 'json' };

export type StackEnvironment = 'development' | 'staging' | 'production';

export interface StackManifestOptions {
  branch?: string;
  commitSha?: string;
  generatedAt?: string;
}

export type RyanAIStackManifest = typeof stackTemplate & {
  environment: StackEnvironment;
  generatedAt: string;
  source: {
    repository: string;
    branch: string;
    commitSha?: string;
  };
};

export function buildRyanAIStackManifest(
  environment: StackEnvironment,
  options: StackManifestOptions = {},
): RyanAIStackManifest {
  const repository =
    process.env.GITHUB_REPOSITORY?.trim() || stackTemplate.repository;
  const branch =
    options.branch?.trim() ||
    process.env.GITHUB_REF_NAME?.trim() ||
    process.env.GIT_BRANCH?.trim() ||
    'local';
  const commitSha =
    options.commitSha?.trim() || process.env.GITHUB_SHA?.trim() || undefined;

  return {
    ...stackTemplate,
    environment,
    generatedAt: options.generatedAt || new Date().toISOString(),
    source: {
      repository,
      branch,
      ...(commitSha ? { commitSha } : {}),
    },
  };
}