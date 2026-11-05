// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MemoryVault from './MemoryVault';

const api = vi.hoisted(() => ({
  listMemory: vi.fn(),
  createMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
}));

vi.mock('@/lib/memoryVaultApi', () => api);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const entry = {
  id: '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11',
  key: 'vault_test',
  value: 'Prefer concise project summaries.',
  category: 'preference',
  createdAt: '2026-11-05T10:00:00.000Z',
};
const secondEntry = {
  ...entry,
  id: '8b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c12',
  value: 'Keep engineering notes searchable.',
};
let container: HTMLDivElement;
let root: Root;

async function mount(open = true) {
  await act(async () => root.render(<MemoryVault open={open} userId="user-a" onClose={vi.fn()} />));
}

async function click(button: Element | null) {
  if (!button) throw new Error('Expected button was not found.');
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function setTextValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listMemory.mockResolvedValue({ entries: [entry], limit: 50, hasMore: false, nextCursor: null, query: '' });
  api.createMemory.mockResolvedValue(entry);
  api.updateMemory.mockResolvedValue(entry);
  api.deleteMemory.mockResolvedValue({ deleted: true, id: entry.id });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Memory Vault backed by Supabase Data API', () => {
  it('loads account memories using the active Supabase identity', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    expect(api.listMemory).toHaveBeenCalledWith('user-a', { query: '', limit: 50, cursor: undefined });
    expect(container.textContent).toContain('same store');
  });

  it('creates a memory through the Supabase Data API adapter', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    const textarea = container.querySelector('#memory-new-content') as HTMLTextAreaElement;
    await setTextValue(textarea, 'Remember the release checklist.');
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Save memory')) ?? null);
    await vi.waitFor(() => expect(api.createMemory).toHaveBeenCalledWith('user-a', {
      value: 'Remember the release checklist.',
      category: 'preference',
    }));
  });

  it('edits an existing memory through the Supabase Data API adapter', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    await click(container.querySelector('button[aria-label="Edit memory"]'));
    const textarea = container.querySelector('textarea[aria-label="Edit memory content"]') as HTMLTextAreaElement;
    await setTextValue(textarea, 'Updated project preference.');
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Save changes')) ?? null);
    await vi.waitFor(() => expect(api.updateMemory).toHaveBeenCalledWith('user-a', entry.id, {
      value: 'Updated project preference.',
      category: 'preference',
    }));
  });

  it('deletes an existing memory through the Supabase Data API adapter', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    await click(container.querySelector('button[aria-label="Delete memory"]'));
    await vi.waitFor(() => expect(api.deleteMemory).toHaveBeenCalledWith('user-a', entry.id));
  });

  it('searches the current account memories using the requested query', async () => {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    const search = container.querySelector('#memory-search') as HTMLInputElement;
    await setTextValue(search, 'project');
    await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Search') ?? null);
    await vi.waitFor(() => expect(api.listMemory).toHaveBeenLastCalledWith('user-a', {
      query: 'project',
      limit: 50,
      cursor: undefined,
    }));
  });

  it('appends the next page without replacing the current page', async () => {
    api.listMemory
      .mockResolvedValueOnce({ entries: [entry], limit: 50, hasMore: true, nextCursor: entry.id, query: '' })
      .mockResolvedValueOnce({ entries: [secondEntry], limit: 50, hasMore: false, nextCursor: null, query: '' });
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain(entry.value));
    await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Load more memories')) ?? null);
    await vi.waitFor(() => expect(container.textContent).toContain(secondEntry.value));
    expect(container.textContent).toContain(entry.value);
    expect(api.listMemory).toHaveBeenLastCalledWith('user-a', {
      query: '',
      limit: 50,
      cursor: entry.id,
    });
  });

  it('shows data access failures instead of pretending a memory was saved', async () => {
    api.listMemory.mockRejectedValueOnce(new Error('Private memory storage is unavailable.'));
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Private memory storage is unavailable.'));
  });
});
