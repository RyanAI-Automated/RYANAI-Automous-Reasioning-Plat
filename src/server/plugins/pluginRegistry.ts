/**
 * Server-owned plugin catalogue and adapter registration boundary.
 *
 * This registry deliberately does not connect providers, authorize users,
 * persist credentials, or expose adapter instances to HTTP callers. Provider
 * execution is reserved for a separately reviewed authorization/execution layer.
 */

export const PLUGIN_CATEGORIES = [
  'workflows',
  'pa_agent',
  'communications',
  'knowledge',
  'engineering',
  'research',
] as const;

export type PluginCategory = typeof PLUGIN_CATEGORIES[number];
export type PluginCapabilityRisk = 'read' | 'write' | 'outbound' | 'destructive';
export type PluginAdapterStatus = 'adapter_required' | 'adapter_registered';
export type PluginDataClassification =
  | 'public_metadata'
  | 'user_content'
  | 'workspace_content'
  | 'personal_data'
  | 'repository_metadata'
  | 'communication_content';

export interface PluginCapabilityManifest {
  readonly id: string;
  readonly risk: PluginCapabilityRisk;
  readonly requiresHumanApproval: boolean;
}

export interface PluginManifest {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly categories: readonly PluginCategory[];
  readonly description: string;
  readonly capabilities: readonly PluginCapabilityManifest[];
  readonly dataClassifications: readonly PluginDataClassification[];
}

export interface PluginAdapterExecutionContext {
  /** Opaque reference resolved by the server-side connection vault. */
  readonly connectionRef: string;
  readonly actorId: string;
  readonly workspaceId?: string;
  readonly requestId: string;
  readonly capabilityId: string;
  readonly signal: AbortSignal;
}

export interface PluginAdapterExecutionRequest {
  readonly capabilityId: string;
  readonly input: unknown;
}

export interface PluginAdapterExecutionResult {
  readonly status: 'completed' | 'accepted' | 'failed';
  readonly output?: unknown;
  readonly providerRequestId?: string;
}

export interface PluginAdapter {
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly capabilities: readonly string[];
  /**
   * Implementations must resolve credentials from server-side storage using
   * connectionRef. Never accept raw access/refresh tokens from request input.
   */
  execute(
    request: PluginAdapterExecutionRequest,
    context: PluginAdapterExecutionContext,
  ): Promise<PluginAdapterExecutionResult>;
}

export interface RegisteredPluginManifest extends PluginManifest {
  readonly adapterStatus: PluginAdapterStatus;
}

export interface PluginRegistry {
  list(): readonly RegisteredPluginManifest[];
  get(providerId: string): RegisteredPluginManifest | null;
  hasAdapter(providerId: string): boolean;
  registerAdapter(adapter: PluginAdapter): void;
}

const CATEGORY_SET = new Set<string>(PLUGIN_CATEGORIES);
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9._-]{1,63}$/;
const RISK_SET = new Set<PluginCapabilityRisk>(['read', 'write', 'outbound', 'destructive']);
const CLASSIFICATION_SET = new Set<PluginDataClassification>([
  'public_metadata',
  'user_content',
  'workspace_content',
  'personal_data',
  'repository_metadata',
  'communication_content',
]);

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid plugin identifier for ${label}.`);
  }
}

function normalizeManifest(manifest: PluginManifest): PluginManifest {
  assertIdentifier(manifest.id, 'provider');
  if (typeof manifest.displayName !== 'string' || !manifest.displayName.trim()) {
    throw new Error(`${manifest.id} must have a display name.`);
  }
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error(`${manifest.id} must declare a manifest version.`);
  }
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
    throw new Error(`${manifest.id} must have a description.`);
  }
  if (!Array.isArray(manifest.categories) || manifest.categories.length === 0) {
    throw new Error(`${manifest.id} must declare at least one category.`);
  }
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    throw new Error(`${manifest.id} must declare at least one capability.`);
  }
  if (!Array.isArray(manifest.dataClassifications) || manifest.dataClassifications.length === 0) {
    throw new Error(`${manifest.id} must declare at least one data classification.`);
  }

  const categories = [...new Set(manifest.categories)];
  for (const category of categories) {
    if (!CATEGORY_SET.has(category)) throw new Error(`${manifest.id} declares an unsupported category.`);
  }

  const capabilityIds = new Set<string>();
  const capabilities = manifest.capabilities.map((capability) => {
    assertIdentifier(capability.id, 'capability');
    if (capabilityIds.has(capability.id)) {
      throw new Error(`${manifest.id} declares duplicate capability ${capability.id}.`);
    }
    capabilityIds.add(capability.id);
    if (!RISK_SET.has(capability.risk)) {
      throw new Error(`${manifest.id} capability ${capability.id} has an unsupported risk level.`);
    }
    if (typeof capability.requiresHumanApproval !== 'boolean') {
      throw new Error(`${manifest.id} capability ${capability.id} must declare its human-approval policy.`);
    }
    return Object.freeze({
      id: capability.id,
      risk: capability.risk,
      requiresHumanApproval: capability.requiresHumanApproval,
    });
  });

  const dataClassifications = [...new Set(manifest.dataClassifications)];
  for (const classification of dataClassifications) {
    if (!CLASSIFICATION_SET.has(classification)) {
      throw new Error(`${manifest.id} declares an unsupported data classification.`);
    }
  }

  return Object.freeze({
    id: manifest.id,
    displayName: manifest.displayName.trim(),
    version: manifest.version.trim(),
    categories: Object.freeze(categories),
    description: manifest.description.trim(),
    capabilities: Object.freeze(capabilities),
    dataClassifications: Object.freeze(dataClassifications),
  });
}

function toRegisteredManifest(
  manifest: PluginManifest,
  adapterStatus: PluginAdapterStatus,
): RegisteredPluginManifest {
  return Object.freeze({
    ...manifest,
    adapterStatus,
  });
}

/**
 * Construct an isolated registry. The public surface exposes catalogue
 * metadata only; registered adapter instances and their execute methods remain
 * private to the server process.
 */
export function createPluginRegistry(manifests: readonly PluginManifest[]): PluginRegistry {
  const catalogue = new Map<string, PluginManifest>();
  const adapters = new Map<string, PluginAdapter>();

  for (const input of manifests) {
    const manifest = normalizeManifest(input);
    if (catalogue.has(manifest.id)) {
      throw new Error(`Duplicate plugin manifest: ${manifest.id}`);
    }
    catalogue.set(manifest.id, manifest);
  }

  const getSnapshot = (providerId: string): RegisteredPluginManifest | null => {
    const manifest = catalogue.get(providerId);
    if (!manifest) return null;
    return toRegisteredManifest(
      manifest,
      adapters.has(providerId) ? 'adapter_registered' : 'adapter_required',
    );
  };

  return Object.freeze({
    list: () => Object.freeze(
      [...catalogue.keys()]
        .sort()
        .map((providerId) => getSnapshot(providerId)!)
    ),
    get: (providerId: string) => getSnapshot(providerId),
    hasAdapter: (providerId: string) => adapters.has(providerId),
    registerAdapter: (adapter: PluginAdapter) => {
      assertIdentifier(adapter.providerId, 'adapter provider');
      const manifest = catalogue.get(adapter.providerId);
      if (!manifest) {
        throw new Error(`No plugin manifest is registered for ${adapter.providerId}.`);
      }
      if (adapters.has(adapter.providerId)) {
        throw new Error(`An adapter is already registered for ${adapter.providerId}.`);
      }
      if (typeof adapter.adapterVersion !== 'string' || !adapter.adapterVersion.trim()) {
        throw new Error(`${adapter.providerId} adapter must declare a version.`);
      }
      if (typeof adapter.execute !== 'function') {
        throw new Error(`${adapter.providerId} adapter must implement execute.`);
      }
      if (!Array.isArray(adapter.capabilities) || adapter.capabilities.length === 0) {
        throw new Error(`${adapter.providerId} adapter must declare at least one capability.`);
      }

      const declared = new Set(manifest.capabilities.map((capability) => capability.id));
      const registered = new Set<string>();
      for (const capabilityId of adapter.capabilities) {
        assertIdentifier(capabilityId, 'adapter capability');
        if (!declared.has(capabilityId)) {
          throw new Error(`${adapter.providerId} does not declare capability ${capabilityId}.`);
        }
        if (registered.has(capabilityId)) {
          throw new Error(`${adapter.providerId} adapter declares duplicate capability ${capabilityId}.`);
        }
        registered.add(capabilityId);
      }

      // Copy metadata only. The executable adapter is retained in a private
      // closure and is intentionally absent from all public registry methods.
      adapters.set(adapter.providerId, Object.freeze({
        providerId: adapter.providerId,
        adapterVersion: adapter.adapterVersion.trim(),
        capabilities: Object.freeze([...registered]),
        execute: adapter.execute.bind(adapter),
      }));
    },
  });
}
