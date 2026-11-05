// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import AudiobookStudio from './AudiobookStudio';

const voice = vi.hoisted(() => ({ toggle: vi.fn(), stop: vi.fn() }));
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
vi.mock('@/lib/useVoiceRecognition', () => ({
  useVoiceRecognition: () => ({
    isSupported: false,
    isListening: false,
    state: 'idle',
    interimText: '',
    error: null,
    toggle: voice.toggle,
    stop: voice.stop,
  }),
}));
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
  await act(async () => root.render(<AudiobookStudio userId="synthetic-user-a" />));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'synthetic-chapter-a') });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Audiobook Studio persistence states', () => {
  it('loads the authenticated account library and its latest saved project', async () => {
    api.mockResolvedValueOnce(response({
      projects: [{
        id: 'synthetic-project-a',
        title: 'Persisted synthetic audiobook',
        language: 'en-ZA',
        chapters: [{
          id: 'synthetic-chapter-a',
          title: 'Persisted chapter',
          content: 'Synthetic manuscript text only.',
          narrationSettings: { voice: 'coral', speed: 1, style: 'Clear narration.' },
        }],
      }],
    }));

    await mount();

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Private audiobook library loaded (1 projects).');
      expect(container.textContent).toContain('Persisted chapter');
    });
    expect(api).toHaveBeenCalledExactlyOnceWith('/api/v1/audiobooks');
    expect(
      Array.from(container.querySelectorAll('input'))
        .some((input) => (input as HTMLInputElement).value === 'Persisted synthetic audiobook'),
    ).toBe(true);
    expect(container.textContent).not.toContain('Local draft only');
  });

  it('retains local drafting and reports the server persistence blocker when the API is unavailable', async () => {
    api.mockRejectedValueOnce(new Error('Audiobook database is not configured on this server.'));

    await mount();

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Local draft only — server persistence is unavailable.');
      expect(container.textContent).toContain('Audiobook database is not configured on this server.');
    });
    expect(api).toHaveBeenCalledExactlyOnceWith('/api/v1/audiobooks');
    expect(window.localStorage.getItem('ryanai:audiobook-project:v1:synthetic-user-a'))
      .toContain('My RyanAI Audiobook');
  });

  it('does not create a replacement project when the library request fails', async () => {
    api.mockResolvedValueOnce(response({ error: 'Owner access is required.' }, false, 403));

    await mount();

    await vi.waitFor(() => expect(container.textContent).toContain('Owner access is required.'));
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][0]).toBe('/api/v1/audiobooks');
    expect(container.textContent).toContain('Local draft only — server persistence is unavailable.');
  });
});
