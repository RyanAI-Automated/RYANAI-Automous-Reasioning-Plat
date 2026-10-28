import { readFileSync } from 'node:fs';

export type StackEnvironment = 'development' | 'staging' | 'production';

export interface StackManifestOptions {
  branch?: string;
  commitSha?: string;
  generatedAt?: string;
}

interface StackService {
  name: string;
  runtime: string;
  dockerfile?: string;
  target?: string;
  image?: string;
  port: number;
  healthPath?: string;
  dependsOn?: string[];
  transport?: string;
  persistentVolume?: string;
  requiresSecret?: string;
}

interface StackTemplate {
  $schema: string;
  schemaVersion: string;
  name: string;
  version: string;
  repository: string;
  description: string;
  services: StackService[];
  deploymentTargets: {
    dockerCompose: string;
    kubernetes: string[];
    render: string;
    vercel: string;
  };
  integrations: {
    jarvis: {
      contract: string;
      enabledByDefault: boolean;
      patchPath: string;
      stackPath: string;
      healthPath: string;
      notes: string;
    };
  };
}

/**
 * Load the canonical manifest asset. In source, this resolves to <repo>/stacks;
 * in the compiled API, it resolves to dist/stacks, which the server build copies.
 * Reading at runtime avoids importing a JSON source file outside tsconfig.server's
 * rootDir while keeping one canonical manifest for validation and deployment.
 */
const stackManifestUrl = new URL('../../../stacks/ryanai.stack.json', import.meta.url);
const stackTemplate = JSON.parse(
  readFileSync(stackManifestUrl, 'utf8'),
) as StackTemplate;

export type RyanAIStackManifest = StackTemplate & {
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
