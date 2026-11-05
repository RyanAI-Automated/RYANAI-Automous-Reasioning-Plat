// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import MemoryVault from './MemoryVault';

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const api = vi.mocked(authenticatedFetch);
const entry = {
  id: '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11',
  key: 'vault_test',
  value: 'Prefer concise project summaries.',
  category: 'preference',
  createdAt: '2026-11-05T10:00:00.000Z',
};
let container: HTMLDivElement;
let root: Root;

function response(payload: unknown, ok = true) {
  return { ok, json: async () => payload } as Response;
}

async function mount(open = true) {
  await act(async () => root.render(<MemoryVault open={open} userId="user-a" onClose={vi.fn()} />));
}

async function click(button: Element | null) {
  if (!button) throw new Error('Expected button was not found.');
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.mockImplementation(async (input, init) => {
    const path = String(input);
    if (path === '/api/user/memory' && (!init?.method || init.method === 'GET')) {
      return response({ entries: [entry], limit: 100 });
    }
    if (path === '/api/user/memory' && init?.method === 'POST') {
      return response({ entry: { ...entry, value: JSON.parse(String(init.body)).value } }, true);
    }
    if (path === '/api/user/memory/' + entry.id && init?.method === 'PUT') {
      return response({ entry: { ...entry, value: JSON.parse(String(init.body)).value } });
    }
    if (path === '/api/user/memory/' + entry.id && init?.method === 'DELETE') {
      return response({ deleted: true, id: entry.id });
    }
    throw new Error('Unexpected memory API request: ' + path + ' ' + init?.method);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('persistent Memory Vault', () => {
  it('loads entries from the authenticated shared memory API when opened', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    expect(api).toHaveBeenCalledWith('/api/user/memory', expect.objectContaining({ headers: { Accept: 'application/json' } }));
    expect(container.textContent).toContain('same store');
  });

  it('creates a memory through the shared Postgres API', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    const textarea = container.querySelector('#memory-new-content') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'Remember the release checklist.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Save memory')) ?? null);
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/user/memory', expect.objectContaining({ method: 'POST' })));
  });

  it('edits an existing memory using its account-scoped endpoint', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    await click(container.querySelector('button[aria-label="Edit memory"]'));
    const textarea = container.querySelector('textarea[aria-label="Edit memory content"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'Updated project preference.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Save changes')) ?? null);
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/user/memory/' + entry.id, expect.objectContaining({ method: 'PUT' })));
  });

  it('deletes an existing memory through the shared Postgres API', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    await click(container.querySelector('button[aria-label="Delete memory"]'));
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/user/memory/' + entry.id, expect.objectContaining({ method: 'DELETE' })));
  });

  it('shows API failures instead of pretending a memory was saved', async () => {
    api.mockRejectedValueOnce(new Error('Private memory storage is unavailable.'));
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Private memory storage is unavailable.'));
  });
});
