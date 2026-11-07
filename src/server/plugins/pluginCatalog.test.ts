import { describe, expect, it } from 'vitest';
import { createDefaultPluginRegistry, DEFAULT_PLUGIN_MANIFESTS } from './pluginCatalog.js';

describe('default server plugin catalogue', () => {
  it('contains the core integrations shown in RyanAI Settings', () => {
    const registry = createDefaultPluginRegistry();
    const ids = registry.list().map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining([
      'github',
      'google-calendar',
      'microsoft-365-calendar',
      'gmail',
      'outlook-mail',
      'slack',
      'microsoft-teams',
      'whatsapp-business',
      'twilio',
      'notion',
      'dropbox',
      'sharepoint',
      'asana',
      'linear',
      'trello',
      'zapier',
      'firecrawl',
    ]));
  });

  it('marks every provider as adapter_required until a real adapter is registered', () => {
    expect(createDefaultPluginRegistry().list().every((entry) => entry.adapterStatus === 'adapter_required'))
      .toBe(true);
  });

  it('requires human approval for every outbound or destructive capability', () => {
    for (const manifest of DEFAULT_PLUGIN_MANIFESTS) {
      for (const capability of manifest.capabilities) {
        if (capability.risk === 'outbound' || capability.risk === 'destructive') {
          expect(capability.requiresHumanApproval, `${manifest.id}:${capability.id}`).toBe(true);
        }
      }
    }
  });

  it('does not include credential, token or connection values in catalogue metadata', () => {
    const serialized = JSON.stringify(createDefaultPluginRegistry().list());
    expect(serialized).not.toMatch(/access.?token|refresh.?token|client.?secret|password|credential/i);
  });
});
