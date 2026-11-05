// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import OperationsCenter from './OperationsCenter';

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const apiFetch = vi.mocked(authenticatedFetch);
let container: HTMLDivElement;
let root: Root;

function response(payload: unknown, ok = true) {
  return { ok, json: async () => payload } as Response;
}

async function mount(isAdmin = false) {
  await act(async () => root.render(<OperationsCenter isAdmin={isAdmin} />));
}

async function click(element: Element | null) {
  if (!element) throw new Error('Expected control was not found.');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockImplementation(async (input, init) => {
    const path = String(input);
    if (path === '/api/agent/ops/tasks' && init?.method === 'POST') {
      return response({ success: true, taskId: 'task-queued-1', status: 'queued' });
    }
    if (path === '/api/agent/ops/tasks') {
      return response({ tasks: [{ id: 'task-1', objective: 'Review the platform wiring', status: 'completed', createdAt: '2026-11-05T10:00:00.000Z', result: { synthesis: 'Wiring review complete.' }, handoffs: [] }] });
    }
    if (path === '/api/actions') {
      return response({ actions: [{ id: 'action-1', tool: 'send_message', summary: 'Send the approved project update.', createdAt: '2026-11-05T10:01:00.000Z', expiresAt: '2026-11-05T11:01:00.000Z' }] });
    }
    if (path === '/api/actions/action-1/approve') {
      return response({ status: 'executed' });
    }
    if (path === '/api/actions/action-1/reject') {
      return response({ status: 'rejected' });
    }
    throw new Error('Unexpected API request: ' + path);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Operations Center', () => {
  it('loads authenticated task history and the administrator approval inbox', async () => {
    await mount(true);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Review the platform wiring');
      expect(container.textContent).toContain('Send the approved project update.');
    });
    expect(apiFetch).toHaveBeenCalledWith('/api/agent/ops/tasks');
    expect(apiFetch).toHaveBeenCalledWith('/api/actions');
  });

  it('requires a second explicit confirmation before executing a pending action', async () => {
    await mount(true);
    await vi.waitFor(() => expect(container.textContent).toContain('Send the approved project update.'));
    await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Review approval')) ?? null);
    expect(container.textContent).toContain('This approval can execute the queued action');
    expect(apiFetch).not.toHaveBeenCalledWith('/api/actions/action-1/approve', expect.anything());
    await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Confirm and execute')) ?? null);
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/actions/action-1/approve', expect.objectContaining({ method: 'POST' })));
  });

  it('does not request the administrator-only approval queue for a regular account', async () => {
    await mount(false);
    await vi.waitFor(() => expect(container.textContent).toContain('Review the platform wiring'));
    expect(apiFetch).toHaveBeenCalledWith('/api/agent/ops/tasks');
    expect(apiFetch).not.toHaveBeenCalledWith('/api/actions');
    expect(container.textContent).not.toContain('Administrator approval inbox');
  });
});
