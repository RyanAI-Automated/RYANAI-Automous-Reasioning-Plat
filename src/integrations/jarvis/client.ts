import type { RyanAIStackManifest } from './stackManifest.js';

export interface JarvisPatchSubmission {
  title: string;
  targetPath: string;
  patchContent: string;
  branch: string;
  baseBranch: string;
  pullRequestUrl?: string;
  requestedBy?: string;
}

export interface JarvisIntegrationStatus {
  provider: 'jarvis';
  enabled: boolean;
  configured: boolean;
  reachable: boolean | null;
  checkedAt: string;
  baseUrl?: string;
  remoteStatus?: string;
  reason?: string;
}

export interface JarvisSubmissionReceipt {
  accepted: boolean;
  statusCode: number;
  remoteId?: string;
  remoteStatus?: string;
  submittedAt: string;
  response?: unknown;
}

interface JarvisConfig {
  enabled: boolean;
  configured: boolean;
  reason?: string;
  baseUrl?: URL;
  token?: string;
  healthPath: string;
  patchPath: string;
  stackPath: string;
}

type Environment = Record<string, string | undefined>;
type Fetcher = typeof fetch;

const MAX_PATCH_CHARS = 200_000;
const DEFAULT_HEALTH_PATH = '/health';
const DEFAULT_PATCH_PATH = '/api/v1/patches';
const DEFAULT_STACK_PATH = '/api/v1/stacks';

export class JarvisIntegrationError extends Error {
  constructor(message: string, public readonly statusCode = 502) {
    super(message);
    this.name = 'JarvisIntegrationError';
  }
}

/**
 * Connector for the documented RyanAI-to-Jarvis REST contract.
 * Sync is disabled unless JARVIS_SYNC_ENABLED=true and a base URL/token are set.
 */
export class JarvisClient {
  constructor(
    private readonly environment: Environment = process.env,
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  /** Return configuration and reachability without ever disclosing the API token. */
  async status(): Promise<JarvisIntegrationStatus> {
    const config = this.resolveConfig();
    const checkedAt = new Date().toISOString();
    if (!config.enabled || !config.baseUrl || !config.token) {
      return {
        provider: 'jarvis',
        enabled: false,
        configured: config.configured,
        reachable: null,
        checkedAt,
        ...(config.baseUrl ? { baseUrl: config.baseUrl.origin } : {}),
        reason: config.reason || 'Jarvis sync is disabled.',
      };
    }

    try {
      // Narrow the config once after the explicit guard above; TypeScript does not
      // preserve property narrowing across the config object passed to request().
      const activeConfig = config as JarvisConfig & { baseUrl: URL; token: string };
      const result = await this.request(activeConfig, activeConfig.healthPath, 'GET');
      return {
        provider: 'jarvis',
        enabled: true,
        configured: true,
        reachable: true,
        checkedAt,
        baseUrl: config.baseUrl.origin,
        remoteStatus: extractRemoteStatus(result.body),
      };
    } catch (error: unknown) {
      return {
        provider: 'jarvis',
        enabled: true,
        configured: true,
        reachable: false,
        checkedAt,
        baseUrl: config.baseUrl.origin,
        reason: safeErrorMessage(error),
      };
    }
  }

  /** Submit a candidate patch to Jarvis for review; this never applies files locally. */
  async submitPatch(input: JarvisPatchSubmission): Promise<JarvisSubmissionReceipt> {
    const config = this.requireEnabledConfig();
    validatePatchSubmission(input);
    const submittedAt = new Date().toISOString();
    const response = await this.request(config, config.patchPath, 'POST', {
      schemaVersion: 'ryanai.jarvis.patch/v1',
      source: 'ryanai',
      submittedAt,
      title: input.title.trim(),
      targetPath: input.targetPath,
      patchContent: input.patchContent,
      branch: input.branch,
      baseBranch: input.baseBranch,
      ...(input.pullRequestUrl ? { pullRequestUrl: validatePullRequestUrl(input.pullRequestUrl) } : {}),
      ...(input.requestedBy ? { requestedBy: input.requestedBy.slice(0, 200) } : {}),
    });
    return {
      accepted: true,
      statusCode: response.statusCode,
      remoteId: getStringProperty(response.body, 'id') || getStringProperty(response.body, 'patchId'),
      remoteStatus: extractRemoteStatus(response.body),
      submittedAt,
      ...(response.body === undefined ? {} : { response: response.body }),
    };
  }

  /** Publish the non-secret stack manifest to Jarvis; production needs a separate opt-in. */
  async publishStack(manifest: RyanAIStackManifest): Promise<JarvisSubmissionReceipt> {
    const config = this.requireEnabledConfig();
    if (manifest.environment === 'production' && this.environment.JARVIS_ALLOW_PRODUCTION_SYNC !== 'true') {
      throw new JarvisIntegrationError(
        'Production stack publishing is blocked. Set JARVIS_ALLOW_PRODUCTION_SYNC=true after reviewing the Jarvis target.',
        403,
      );
    }
    const submittedAt = new Date().toISOString();
    const response = await this.request(config, config.stackPath, 'POST', {
      schemaVersion: 'ryanai.jarvis.stack/v1',
      source: 'ryanai',
      submittedAt,
      stack: manifest,
    });
    return {
      accepted: true,
      statusCode: response.statusCode,
      remoteId: getStringProperty(response.body, 'id') || getStringProperty(response.body, 'stackId'),
      remoteStatus: extractRemoteStatus(response.body),
      submittedAt,
      ...(response.body === undefined ? {} : { response: response.body }),
    };
  }

  private requireEnabledConfig(): JarvisConfig & { baseUrl: URL; token: string } {
    const config = this.resolveConfig();
    if (!config.enabled || !config.baseUrl || !config.token) {
      throw new JarvisIntegrationError(config.reason || 'Jarvis sync is not configured.', 503);
    }
    return config as JarvisConfig & { baseUrl: URL; token: string };
  }

  private resolveConfig(): JarvisConfig {
    const rawBaseUrl = this.environment.JARVIS_BASE_URL?.trim();
    const rawToken = this.environment.JARVIS_API_TOKEN?.trim();
    const baseConfig = {
      enabled: false,
      configured: false,
      healthPath: DEFAULT_HEALTH_PATH,
      patchPath: DEFAULT_PATCH_PATH,
      stackPath: DEFAULT_STACK_PATH,
    };

    if (!rawBaseUrl) {
      return { ...baseConfig, reason: 'JARVIS_BASE_URL is not configured.' };
    }

    let baseUrl: URL;
    try {
      baseUrl = new URL(rawBaseUrl);
    } catch {
      return { ...baseConfig, reason: 'JARVIS_BASE_URL must be an absolute HTTP or HTTPS URL.' };
    }
    if (
      !['http:', 'https:'].includes(baseUrl.protocol) ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash ||
      baseUrl.pathname !== '/'
    ) {
      return {
        ...baseConfig,
        reason: 'JARVIS_BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment.',
      };
    }

    if (!rawToken) {
      return {
        ...baseConfig,
        baseUrl,
        reason: 'JARVIS_API_TOKEN is not configured.',
      };
    }
    if (this.environment.JARVIS_SYNC_ENABLED !== 'true') {
      return {
        ...baseConfig,
        configured: true,
        baseUrl,
        reason: 'Jarvis is configured but disabled. Set JARVIS_SYNC_ENABLED=true to enable outbound sync.',
      };
    }

    try {
      return {
        enabled: true,
        configured: true,
        baseUrl,
        token: rawToken,
        healthPath: validateEndpointPath(this.environment.JARVIS_HEALTH_PATH || DEFAULT_HEALTH_PATH),
        patchPath: validateEndpointPath(this.environment.JARVIS_PATCH_PATH || DEFAULT_PATCH_PATH),
        stackPath: validateEndpointPath(this.environment.JARVIS_STACK_PATH || DEFAULT_STACK_PATH),
      };
    } catch (error: unknown) {
      return {
        ...baseConfig,
        baseUrl,
        reason: safeErrorMessage(error),
      };
    }
  }

  private async request(
    config: JarvisConfig & { baseUrl: URL; token: string },
    endpointPath: string,
    method: 'GET' | 'POST',
    payload?: unknown,
  ): Promise<{ statusCode: number; body: unknown }> {
    const url = new URL(endpointPath, config.baseUrl);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers: {
          accept: 'application/json',
          authorization: 'Bearer ' + config.token,
          'content-type': 'application/json',
          'user-agent': 'RyanAI-Jarvis-Bridge/1.0',
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      throw new JarvisIntegrationError('Jarvis request failed: ' + safeErrorMessage(error));
    }

    const rawBody = await response.text().catch(() => '');
    const body = parseResponseBody(rawBody);
    if (!response.ok) {
      const detail = typeof rawBody === 'string' ? rawBody.slice(0, 300).trim() : '';
      throw new JarvisIntegrationError(
        'Jarvis returned HTTP ' + response.status + (detail ? ': ' + detail : '.'),
      );
    }
    return { statusCode: response.status, body };
  }
}

export const jarvisClient = new JarvisClient();

function validatePatchSubmission(input: JarvisPatchSubmission): void {
  if (!input.title.trim() || input.title.trim().length > 240) {
    throw new JarvisIntegrationError('Patch title must contain 1 to 240 characters.', 400);
  }
  const targetPath = input.targetPath.trim();
  const pathParts = targetPath.split('/');
  if (
    !targetPath ||
    targetPath.length > 300 ||
    targetPath.startsWith('/') ||
    targetPath.includes('\\') ||
    targetPath.includes('\0') ||
    pathParts.some((part) => !part || part === '.' || part === '..') ||
    pathParts.some((part) => ['.git', 'node_modules', '.ssh', '.aws', '.config'].includes(part)) ||
    pathParts.some((part) => part.startsWith('.env')) ||
    ['.npmrc', '.netrc', '.git-credentials'].some((name) => pathParts.includes(name)) ||
    /\.(pem|key|p12|pfx)$/i.test(targetPath)
  ) {
    throw new JarvisIntegrationError('Patch targetPath must be a safe relative workspace path.', 400);
  }
  if (!input.patchContent.trim() || input.patchContent.length > MAX_PATCH_CHARS) {
    throw new JarvisIntegrationError('patchContent must contain 1 to 200,000 characters.', 400);
  }
  if (!isValidRef(input.branch) || !isValidRef(input.baseBranch)) {
    throw new JarvisIntegrationError('branch and baseBranch must be valid, single-line Git refs.', 400);
  }
}

function validatePullRequestUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new JarvisIntegrationError('pullRequestUrl must be an HTTPS GitHub pull-request URL.', 400);
  }
  if (
    url.protocol !== 'https:' ||
    !['github.com'].includes(url.hostname.toLowerCase()) ||
    !/^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(url.pathname)
  ) {
    throw new JarvisIntegrationError('pullRequestUrl must be an HTTPS GitHub pull-request URL.', 400);
  }
  return url.toString();
}

function validateEndpointPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('?') || path.includes('#')) {
    throw new Error('Jarvis endpoint paths must be absolute paths without query or fragment.');
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Jarvis endpoint paths cannot contain dot segments.');
  }
  return path;
}

function isValidRef(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !/[\s~^:?*[\]\\]/.test(value) &&
    !value.startsWith('-') &&
    !value.includes('..') &&
    !value.includes('@{') &&
    !value.endsWith('/') &&
    !value.endsWith('.')
  );
}

function parseResponseBody(rawBody: string): unknown {
  if (!rawBody.trim()) return undefined;
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return { message: rawBody.slice(0, 300) };
  }
}

function extractRemoteStatus(body: unknown): string {
  const status = getStringProperty(body, 'status') || getStringProperty(body, 'state');
  return status || 'ok';
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' && property.length <= 300 ? property : undefined;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
