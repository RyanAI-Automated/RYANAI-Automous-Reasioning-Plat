// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './Dashboard';

vi.mock('@/hooks/usePlatformHealth', () => ({
  usePlatformHealth: () => ({
    health: null,
    error: null,
    checking: false,
    refresh: vi.fn(),
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: 'PA observer unavailable in this test.' }),
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderDashboard(isOwner = false, isAdmin = false) {
  await act(async () => {
    root.render(<DashboardPage isOwner={isOwner} isAdmin={isAdmin} />);
  });
}

describe('System Dashboard workspace launcher', () => {
  it('links to each regular-account workspace', async () => {
    await renderDashboard();

    expect(container.textContent).toContain('Platform workspaces');
    for (const [path, label] of [
      ['#/cockpit', 'Command Cockpit'],
      ['#/operator', 'Operator Console'],
      ['#/operations', 'Operations Center'],
      ['#/settings', 'Profile & Settings'],
      ['#/quant', 'Quant Lab'],
      ['#/workspace', 'Reasoning Workspace'],
      ['#/audiobook', 'Audiobook Studio'],
    ]) {
      const link = container.querySelector(`a[href="${path}"]`);
      expect(link?.textContent).toContain(label);
    }
    expect(container.querySelector('a[href="#/comms"]')).toBeNull();
    expect(container.querySelector('a[href="#/admin"]')).toBeNull();
  });

  it('adds the Admin Console only for an administrator session', async () => {
    await renderDashboard(false, true);
    const adminLink = container.querySelector('a[href="#/admin"]');
    expect(adminLink?.textContent).toContain('Admin Console');
  });

  it('adds RyanAI Comms only for an owner session', async () => {
    await renderDashboard(true);

    const commsLink = container.querySelector('a[href="#/comms"]');
    expect(commsLink?.textContent).toContain('RyanAI Comms');
  });
});
