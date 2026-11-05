/**
 * Typed, fail-closed execution boundary for replaceable specialist models.
 *
 * This module deliberately does not instantiate providers, download weights,
 * or grant production activation. Callers must supply current governance
 * policy and an independent Gen-X authorization adapter for every invocation.
 */

export const SPECIALIST_MODEL_IDS = [
  'specialist.gliner',
  'specialist.embeddinggemma',
  'specialist.paddleocr_vl',
  'specialist.parakeet',
  'specialist.kokoro',
  'specialist.hydrogen',
  'specialist.nemotron_orchestrator',
  'specialist.arch_router',
] as const;

export type SpecialistModelId = typeof SPECIALIST_MODEL_IDS[number];
export type SpecialistExecutionMode = 'offline_benchmark' | 'production';
export type SpecialistPolicyStatus =
  | 'evaluation_only'
  | 'deferred_legal_review'
  | 'disabled'
  | 'verified';

export interface SpecialistExecutionContext {
  readonly requestId: string;
  readonly mode: SpecialistExecutionMode;
  readonly signal: AbortSignal;
}

export interface SpecialistAdapter<Input, Output> {
  readonly id: SpecialistModelId;
  /** Exact checkpoint/revision identifier; never use a floating "latest" tag. */
  readonly modelRevision: string;
  validateInput(input: unknown): input is Input;
  invoke(input: Input, context: SpecialistExecutionContext): Promise<Output>;
}

interface RegisteredSpecialistAdapter {
  readonly id: SpecialistModelId;
  readonly modelRevision: string;
  validateInput(input: unknown): boolean;
  invoke(input: unknown, context: SpecialistExecutionContext): Promise<unknown>;
}

/**
 * Erases the adapter's generic types only at the registry boundary. The input
 * type guard is re-run before invoking the typed adapter.
 */
export function defineSpecialistAdapter<Input, Output>(
  adapter: SpecialistAdapter<Input, Output>,
): RegisteredSpecialistAdapter {
  if (!SPECIALIST_MODEL_IDS.includes(adapter.id)) {
    throw new Error(`Unsupported specialist model id: ${String(adapter.id)}`);
  }
  if (!adapter.modelRevision.trim()) {
    throw new Error(`${adapter.id} requires an exact model revision.`);
  }

  return {
    id: adapter.id,
    modelRevision: adapter.modelRevision,
    validateInput: (input) => adapter.validateInput(input),
    invoke: (input, context) => {
      if (!adapter.validateInput(input)) {
        throw new SpecialistRegistryError('invalid_input', `${adapter.id} rejected the input schema.`);
      }
      return adapter.invoke(input, context);
    },
  };
}

export interface SpecialistPolicyRecord {
  readonly id: SpecialistModelId;
  readonly status: SpecialistPolicyStatus;
  readonly activation: string;
}

export interface SpecialistAuthorizationRequest {
  readonly modelId: SpecialistModelId;
  readonly modelRevision: string;
  readonly mode: SpecialistExecutionMode;
  readonly requestId: string;
}

export interface SpecialistAuthorizationDecision {
  readonly allowed: boolean;
  /** Version of the deterministic policy used by Gen-X. */
  readonly policyVersion: string;
  /** Audit/approval reference, not a credential or bearer token. */
  readonly authorizationReference: string;
  readonly reason?: string;
}

export interface SpecialistInvocationAuthorizer {
  authorize(request: SpecialistAuthorizationRequest): Promise<SpecialistAuthorizationDecision>;
}

export interface SpecialistInvocationRequest {
  readonly modelId: SpecialistModelId;
  readonly modelRevision: string;
  readonly mode: SpecialistExecutionMode;
  readonly requestId: string;
  readonly input: unknown;
  readonly signal: AbortSignal;
  /** Optional per-call deadline; the registry enforces the configured maximum. */
  readonly timeoutMs?: number;
}

export interface SpecialistInvocationResult<Output = unknown> {
  readonly modelId: SpecialistModelId;
  readonly modelRevision: string;
  readonly mode: SpecialistExecutionMode;
  readonly policyVersion: string;
  readonly authorizationReference: string;
  readonly requestedAt: string;
  readonly completedAt: string;
  /** Treat this value as untrusted data; it never carries action authority. */
  readonly output: Output;
}

export type SpecialistRegistryErrorCode =
  | 'adapter_missing'
  | 'revision_mismatch'
  | 'policy_missing'
  | 'policy_denied'
  | 'unsafe_activation'
  | 'invalid_input'
  | 'cancelled'
  | 'timeout';

export class SpecialistRegistryError extends Error {
  readonly code: SpecialistRegistryErrorCode;

  constructor(code: SpecialistRegistryErrorCode, message: string) {
    super(message);
    this.name = 'SpecialistRegistryError';
    this.code = code;
  }
}

export interface SpecialistAdapterRegistryOptions {
  readonly adapters: readonly RegisteredSpecialistAdapter[];
  /** Must read the authoritative RIIP registry, not model-supplied metadata. */
  readonly getPolicy: (modelId: SpecialistModelId) => SpecialistPolicyRecord | null;
  /** Must delegate to Gen-X; no permissive/default authorizer is provided. */
  readonly authorizer: SpecialistInvocationAuthorizer;
  /** Defaults to 30s; each request is bounded by maxTimeoutMs. */
  readonly defaultTimeoutMs?: number;
  /** Defaults to 120s; prevents a caller from requesting unbounded inference. */
  readonly maxTimeoutMs?: number;
  readonly now?: () => Date;
}

export interface SpecialistAdapterRegistry {
  readonly registeredModelIds: readonly SpecialistModelId[];
  invoke(request: SpecialistInvocationRequest): Promise<SpecialistInvocationResult>;
}

/**
 * Build a registry with no implicit fallback and no implicit authorization.
 * Evaluation-only models can run only in the isolated benchmark mode. Deferred
 * and disabled models cannot run. Production requires a verified policy entry
 * whose activation is explicitly "production".
 */
export function createSpecialistAdapterRegistry(
  options: SpecialistAdapterRegistryOptions,
): SpecialistAdapterRegistry {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  const maxTimeoutMs = options.maxTimeoutMs ?? 120_000;
  if (
    !Number.isSafeInteger(defaultTimeoutMs)
    || defaultTimeoutMs < 1
    || !Number.isSafeInteger(maxTimeoutMs)
    || maxTimeoutMs < defaultTimeoutMs
  ) {
    throw new Error('Specialist registry timeout limits must be positive safe integers, with maxTimeoutMs >= defaultTimeoutMs.');
  }

  const adapters = new Map<SpecialistModelId, RegisteredSpecialistAdapter>();

  for (const adapter of options.adapters) {
    if (adapters.has(adapter.id)) {
      throw new Error(`Duplicate specialist adapter: ${adapter.id}`);
    }
    adapters.set(adapter.id, adapter);
  }

  const registeredModelIds = Object.freeze([...adapters.keys()]);

  return {
    registeredModelIds,
    async invoke(request) {
      if (request.signal.aborted) {
        throw new SpecialistRegistryError('cancelled', 'Specialist invocation was cancelled before authorization.');
      }
      if (typeof request.requestId !== 'string' || !request.requestId.trim()) {
        throw new SpecialistRegistryError('policy_denied', 'A request identifier is required.');
      }
      if (request.mode !== 'offline_benchmark' && request.mode !== 'production') {
        throw new SpecialistRegistryError('invalid_input', 'A supported specialist execution mode is required.');
      }
      const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > maxTimeoutMs) {
        throw new SpecialistRegistryError('invalid_input', `Specialist timeout must be between 1 and ${maxTimeoutMs} milliseconds.`);
      }

      const adapter = adapters.get(request.modelId);
      if (!adapter) {
        throw new SpecialistRegistryError('adapter_missing', `No adapter is registered for ${request.modelId}.`);
      }
      if (request.modelRevision !== adapter.modelRevision) {
        throw new SpecialistRegistryError('revision_mismatch', `Requested revision does not match the pinned adapter for ${request.modelId}.`);
      }
      if (!adapter.validateInput(request.input)) {
        throw new SpecialistRegistryError('invalid_input', `${request.modelId} rejected the input schema.`);
      }

      const policy = options.getPolicy(request.modelId);
      if (!policy || policy.id !== request.modelId) {
        throw new SpecialistRegistryError('policy_missing', `No authoritative RIIP policy exists for ${request.modelId}.`);
      }

      if (policy.status === 'disabled' || policy.status === 'deferred_legal_review') {
        throw new SpecialistRegistryError('unsafe_activation', `${request.modelId} is ${policy.status} and cannot be invoked.`);
      }
      if (request.mode === 'production' && (policy.status !== 'verified' || policy.activation !== 'production')) {
        throw new SpecialistRegistryError('unsafe_activation', `${request.modelId} is not approved for production activation.`);
      }
      if (request.mode === 'offline_benchmark' && policy.status !== 'evaluation_only' && policy.status !== 'verified') {
        throw new SpecialistRegistryError('unsafe_activation', `${request.modelId} is not eligible for offline evaluation.`);
      }

      const requestedAt = (options.now ?? (() => new Date()))().toISOString();
      const decision = await options.authorizer.authorize({
        modelId: request.modelId,
        modelRevision: request.modelRevision,
        mode: request.mode,
        requestId: request.requestId,
      });
      if (
        decision?.allowed !== true
        || typeof decision.policyVersion !== 'string'
        || !decision.policyVersion.trim()
        || typeof decision.authorizationReference !== 'string'
        || !decision.authorizationReference.trim()
      ) {
        throw new SpecialistRegistryError(
          'policy_denied',
          typeof decision?.reason === 'string' && decision.reason
            ? decision.reason
            : 'Gen-X did not provide a complete authorization decision.',
        );
      }
      if (request.signal.aborted) {
        throw new SpecialistRegistryError('cancelled', 'Specialist invocation was cancelled before model execution.');
      }

      const executionController = new AbortController();
      let rejectAbort: ((reason: SpecialistRegistryError) => void) | undefined;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const abortPromise = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
      });
      const onCallerAbort = () => {
        const error = new SpecialistRegistryError('cancelled', 'Specialist invocation was cancelled during model execution.');
        executionController.abort(error);
        rejectAbort?.(error);
      };
      request.signal.addEventListener('abort', onCallerAbort, { once: true });
      if (request.signal.aborted) onCallerAbort();

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          const error = new SpecialistRegistryError('timeout', `Specialist invocation exceeded its ${timeoutMs} ms deadline.`);
          executionController.abort(error);
          reject(error);
        }, timeoutMs);
      });

      let output: unknown;
      try {
        const execution = Promise.resolve().then(() => adapter.invoke(request.input, {
          requestId: request.requestId,
          mode: request.mode,
          signal: executionController.signal,
        }));
        output = await Promise.race([execution, abortPromise, timeoutPromise]);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        request.signal.removeEventListener('abort', onCallerAbort);
      }
      const completedAt = (options.now ?? (() => new Date()))().toISOString();

      return {
        modelId: request.modelId,
        modelRevision: adapter.modelRevision,
        mode: request.mode,
        policyVersion: decision.policyVersion,
        authorizationReference: decision.authorizationReference,
        requestedAt,
        completedAt,
        output,
      };
    },
  };
}
