// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import GithubModal from './GithubModal';

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const api = vi.mocked(authenticatedFetch);
let container: HTMLDivElement;
let root: Root;

function response(payload: unknown, ok = true, status = ok ? 200 : 503) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function mount() {
  await act(async () => root.render(<GithubModal open onClose={vi.fn()} />));
}

async function click(button: Element | null) {
  if (!button) throw new Error('Expected button was not found.');
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('GitHub App integration modal', () => {
  it('keeps connection disabled until server-side App configuration exists', async () => {
    api.mockResolvedValueOnce(response({ status: 'not_configured', connected: false }));
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Not configured'));
    expect(container.textContent).toContain('Register a GitHub App');
    const connect = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Connect GitHub'));
    expect(connect).not.toBeNull();
    expect((connect as HTMLButtonElement).disabled).toBe(true);
    expect(api).toHaveBeenCalledExactlyOnceWith('/api/github/status');
  });

  it('shows only server-verified account and official repository status', async () => {
    api.mockResolvedValueOnce(response({
      status: 'connected',
      connected: true,
      account: { login: 'synthetic-owner' },
      repository: {
        fullName: 'RyanAI-Automated/RYANAI-Automous-Reasioning-Plat',
        permissions: { pull: true, push: false },
      },
      accessTokenExpiresAt: '2026-11-05T20:00:00.000Z',
    }));
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Connected · verified'));
    expect(container.textContent).toContain('synthetic-owner');
    expect(container.textContent).toContain('RyanAI-Automated/RYANAI-Automous-Reasioning-Plat');
    expect(container.textContent).toContain('does not implement pushes');
    expect(container.textContent).not.toContain('ghu.');
    expect(container.textContent).not.toContain('ghr.');
  });

  it('removes the local connection and warns when remote token revocation cannot be confirmed', async () => {
    api.mockResolvedValueOnce(response({
      status: 'connected',
      connected: true,
      account: { login: 'synthetic-owner' },
      repository: { fullName: 'RyanAI-Automated/RYANAI-Automous-Reasioning-Plat', permissions: { pull: true } },
    }));
    api.mockResolvedValueOnce(response({ disconnected: true, remoteRevocation: 'unconfirmed' }));
    api.mockResolvedValueOnce(response({ status: 'not_connected', connected: false, configured: true }));

    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Connected · verified'));
    await click(Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Disconnect GitHub')) ?? null);
    await vi.waitFor(() => expect(container.textContent).toContain('Remote revocation could not be confirmed'));
    expect(api).toHaveBeenCalledWith('/api/github/disconnect', { method: 'POST' });
    expect(container.textContent).toContain('Not connected');
  });
});
