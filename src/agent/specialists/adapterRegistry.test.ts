import { describe, expect, it, vi } from 'vitest';
import {
  createSpecialistAdapterRegistry,
  defineSpecialistAdapter,
  SpecialistRegistryError,
  type SpecialistPolicyRecord,
} from './adapterRegistry.js';

const modelId = 'specialist.gliner' as const;
const revision = 'sha256:gliner-fixture-revision';
const input = { text: 'Ntsiyeni works on RyanAI.' };

function policy(overrides: Partial<SpecialistPolicyRecord> = {}): SpecialistPolicyRecord {
  return {
    id: modelId,
    status: 'evaluation_only',
    activation: 'offline_benchmark_only',
    ...overrides,
  };
}

function adapter(invoke = vi.fn(async (value: typeof input) => ({ entities: [value.text] }))) {
  return defineSpecialistAdapter({
    id: modelId,
    modelRevision: revision,
    validateInput(value: unknown): value is typeof input {
      return typeof value === 'object'
        && value !== null
        && 'text' in value
        && typeof value.text === 'string';
    },
    invoke,
  });
}

function registry(options: {
  status?: SpecialistPolicyRecord['status'];
  activation?: string;
  allowed?: boolean;
  adapters?: ReturnType<typeof adapter>[];
} = {}) {
  const authorizer = {
    authorize: vi.fn(async () => ({
      allowed: options.allowed ?? true,
      policyVersion: 'gen-x-policy-v1',
      authorizationReference: 'audit-ref-001',
      reason: 'Denied by test policy',
    })),
  };
  const descriptor = policy({
    ...(options.status ? { status: options.status } : {}),
    ...(options.activation ? { activation: options.activation } : {}),
  });
  return {
    authorizer,
    registry: createSpecialistAdapterRegistry({
      adapters: options.adapters ?? [adapter()],
      getPolicy: (id) => id === modelId ? descriptor : null,
      authorizer,
      now: () => new Date('2026-11-05T10:00:00.000Z'),
    }),
  };
}

function request(overrides: Partial<Parameters<ReturnType<typeof registry>['registry']['invoke']>[0]> = {}) {
  return {
    modelId,
    modelRevision: revision,
    mode: 'offline_benchmark' as const,
    requestId: 'test-request-001',
    input,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('specialist adapter registry', () => {
  it('fails closed when no adapter exists', async () => {
    const { registry: instance, authorizer } = registry({ adapters: [] });
    await expect(instance.invoke(request())).rejects.toMatchObject<Partial<SpecialistRegistryError>>({
      code: 'adapter_missing',
    });
    expect(authorizer.authorize).not.toHaveBeenCalled();
  });

  it('rejects duplicate adapter identifiers', () => {
    const first = adapter();
    const second = adapter();
    expect(() => registry({ adapters: [first, second] })).toThrow('Duplicate specialist adapter');
  });

  it('requires an exact model revision match', async () => {
    const { registry: instance, authorizer } = registry();
    await expect(instance.invoke(request({ modelRevision: 'latest' }))).rejects.toMatchObject({
      code: 'revision_mismatch',
    });
    expect(authorizer.authorize).not.toHaveBeenCalled();
  });

  it('allows evaluation-only models only in offline benchmark mode', async () => {
    const { registry: instance, authorizer } = registry();
    await expect(instance.invoke(request({ mode: 'production' }))).rejects.toMatchObject({
      code: 'unsafe_activation',
    });
    expect(authorizer.authorize).not.toHaveBeenCalled();
  });

  it('never invokes disabled or legally deferred candidates', async () => {
    for (const status of ['disabled', 'deferred_legal_review'] as const) {
      const { registry: instance, authorizer } = registry({ status });
      await expect(instance.invoke(request())).rejects.toMatchObject({
        code: 'unsafe_activation',
      });
      expect(authorizer.authorize).not.toHaveBeenCalled();
    }
  });

  it('requires a complete affirmative Gen-X decision before invoking the adapter', async () => {
    const run = vi.fn(async (value: typeof input) => ({ entities: [value.text] }));
    const { registry: instance, authorizer } = registry({ allowed: false, adapters: [adapter(run)] });
    await expect(instance.invoke(request())).rejects.toMatchObject({
      code: 'policy_denied',
    });
    expect(authorizer.authorize).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it('validates input before asking Gen-X or invoking a model', async () => {
    const run = vi.fn(async (value: typeof input) => ({ entities: [value.text] }));
    const { registry: instance, authorizer } = registry({ adapters: [adapter(run)] });
    await expect(instance.invoke(request({ input: { text: 42 } }))).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(authorizer.authorize).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('records revision and authorization provenance for an approved evaluation', async () => {
    const run = vi.fn(async (value: typeof input) => ({ entities: [value.text] }));
    const { registry: instance, authorizer } = registry({ adapters: [adapter(run)] });
    const result = await instance.invoke(request());

    expect(authorizer.authorize).toHaveBeenCalledWith({
      modelId,
      modelRevision: revision,
      mode: 'offline_benchmark',
      requestId: 'test-request-001',
    });
    expect(run).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      modelId,
      modelRevision: revision,
      mode: 'offline_benchmark',
      policyVersion: 'gen-x-policy-v1',
      authorizationReference: 'audit-ref-001',
      requestedAt: '2026-11-05T10:00:00.000Z',
      completedAt: '2026-11-05T10:00:00.000Z',
      output: { entities: [input.text] },
    });
  });

  it('requires verified status and explicit production activation for production mode', async () => {
    const { registry: instance, authorizer } = registry({
      status: 'verified',
      activation: 'offline_benchmark_only',
    });
    await expect(instance.invoke(request({ mode: 'production' }))).rejects.toMatchObject({
      code: 'unsafe_activation',
    });
    expect(authorizer.authorize).not.toHaveBeenCalled();
  });

  it('checks cancellation before authorization and again before execution', async () => {
    const controller = new AbortController();
    controller.abort();
    const { registry: instance, authorizer } = registry();
    await expect(instance.invoke(request({ signal: controller.signal }))).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(authorizer.authorize).not.toHaveBeenCalled();
  });

  it('requires a current governance policy record', async () => {
    const authorizer = {
      authorize: vi.fn(async () => ({
        allowed: true,
        policyVersion: 'gen-x-policy-v1',
        authorizationReference: 'audit-ref-001',
      })),
    };
    const instance = createSpecialistAdapterRegistry({
      adapters: [adapter()],
      getPolicy: () => null,
      authorizer,
    });
    await expect(instance.invoke(request())).rejects.toMatchObject({
      code: 'policy_missing',
    });
    expect(authorizer.authorize).not.toHaveBeenCalled();
  });
});
