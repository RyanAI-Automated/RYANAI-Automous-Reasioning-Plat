import { describe, expect, it } from 'vitest';
import {
  createPluginRegistry,
  type PluginAdapter,
  type PluginManifest,
} from './pluginRegistry.js';

const manifest: PluginManifest = {
  id: 'github',
  displayName: 'GitHub',
  version: '1.0.0',
  categories: ['engineering', 'workflows'],
  description: 'Repository and engineering workflow integration.',
  capabilities: [
    { id: 'repositories.read', risk: 'read', requiresHumanApproval: false },
    { id: 'pull_requests.write', risk: 'write', requiresHumanApproval: true },
  ],
  dataClassifications: ['user_content', 'repository_metadata'],
};

function adapter(overrides: Partial<PluginAdapter> = {}): PluginAdapter {
  return {
    providerId: 'github',
    adapterVersion: '1.0.0',
    capabilities: ['repositories.read'],
    execute: async () => ({ status: 'completed' }),
    ...overrides,
  };
}

describe('server plugin registry', () => {
  it('lists catalogue entries as adapter_required until a matching adapter is registered', () => {
    const registry = createPluginRegistry([manifest]);
    expect(registry.list()).toEqual([{
      ...manifest,
      capabilities: manifest.capabilities,
      adapterStatus: 'adapter_required',
    }]);
    expect(registry.hasAdapter('github')).toBe(false);
  });

  it('registers an adapter only for a known provider and declared capabilities', () => {
    const registry = createPluginRegistry([manifest]);
    registry.registerAdapter(adapter());
    expect(registry.hasAdapter('github')).toBe(true);
    expect(registry.get('github')?.adapterStatus).toBe('adapter_registered');
  });

  it('rejects an adapter for an unknown provider', () => {
    const registry = createPluginRegistry([manifest]);
    expect(() => registry.registerAdapter(adapter({ providerId: 'unknown' })))
      .toThrow('No plugin manifest is registered for unknown');
  });

  it('rejects adapter capabilities not declared by the provider manifest', () => {
    const registry = createPluginRegistry([manifest]);
    expect(() => registry.registerAdapter(adapter({ capabilities: ['repositories.delete'] })))
      .toThrow('does not declare capability repositories.delete');
  });

  it('rejects duplicate providers and duplicate adapter registration', () => {
    expect(() => createPluginRegistry([manifest, manifest])).toThrow('Duplicate plugin manifest: github');
    const registry = createPluginRegistry([manifest]);
    registry.registerAdapter(adapter());
    expect(() => registry.registerAdapter(adapter())).toThrow('An adapter is already registered for github');
  });

  it('returns defensive, immutable catalogue snapshots', () => {
    const registry = createPluginRegistry([manifest]);
    const result = registry.list();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0].capabilities)).toBe(true);
  });

  it('does not expose executable adapter instances through catalogue APIs', () => {
    const registry = createPluginRegistry([manifest]);
    registry.registerAdapter(adapter());
    const listed = registry.get('github')!;
    expect('execute' in listed).toBe(false);
    expect('credentials' in listed).toBe(false);
    expect('accessToken' in listed).toBe(false);
  });

  it('rejects malformed manifests and invalid identifiers', () => {
    expect(() => createPluginRegistry([{ ...manifest, id: 'GitHub' }])).toThrow('Invalid plugin identifier');
    expect(() => createPluginRegistry([{ ...manifest, capabilities: [] }])).toThrow('must declare at least one capability');
    expect(() => createPluginRegistry([{ ...manifest, categories: [] }])).toThrow('must declare at least one category');
  });

  it('keeps high-risk capabilities explicitly marked for human approval', () => {
    const registry = createPluginRegistry([manifest]);
    expect(registry.get('github')?.capabilities.find((item) => item.id === 'pull_requests.write'))
      .toMatchObject({ risk: 'write', requiresHumanApproval: true });
  });
});
