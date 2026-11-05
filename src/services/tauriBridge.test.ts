import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TauriBridge } from './tauriBridge';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  getSession: vi.fn(),
  executeAgentReasoning: vi.fn(),
  fetchSystemHealth: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));
vi.mock('./api', () => ({
  executeAgentReasoning: mocks.executeAgentReasoning,
  fetchSystemHealth: mocks.fetchSystemHealth,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTauri.mockReturnValue(true);
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'signed-in-session-token' } },
    error: null,
  });
  mocks.invoke.mockResolvedValue({
    status: 'completed',
    objective: 'inspect the service',
    result: 'Reasoning completed.',
  });
});
afterEach(() => vi.restoreAllMocks());

describe('Tauri authenticated reasoning bridge', () => {
  it('passes the current signed-in session token to the native command', async () => {
    await expect(TauriBridge.executeObjective('  inspect the service  ')).resolves.toEqual({
      status: 'completed',
      objective: 'inspect the service',
      result: 'Reasoning completed.',
    });

    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('trigger_agent_objective', {
      objective: 'inspect the service',
      accessToken: 'signed-in-session-token',
    });
  });

  it('fails closed when no authenticated session is available', async () => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });

    await expect(TauriBridge.executeObjective('inspect the service')).rejects.toThrow(
      'Sign in to continue.',
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('fails closed when Supabase session retrieval fails', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('session unavailable'),
    });

    await expect(TauriBridge.executeObjective('inspect the service')).rejects.toThrow(
      'Sign in to continue.',
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('fails closed for Supabase anonymous sessions', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'anonymous-session-token',
          user: { is_anonymous: true },
        },
      },
      error: null,
    });

    await expect(TauriBridge.executeObjective('inspect the service')).rejects.toThrow(
      'Sign in to continue.',
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });


  it('keeps the browser fallback on the authenticated API service', async () => {
    mocks.isTauri.mockReturnValue(false);
    mocks.executeAgentReasoning.mockResolvedValue({
      success: true,
      objective: 'inspect the service',
      output: 'Browser reasoning completed.',
    });

    await expect(TauriBridge.executeObjective('inspect the service')).resolves.toMatchObject({
      status: 'completed',
      result: 'Browser reasoning completed.',
    });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.executeAgentReasoning).toHaveBeenCalledExactlyOnceWith('inspect the service');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('rejects empty objectives before reading credentials or invoking native IPC', async () => {
    await expect(TauriBridge.executeObjective('   ')).rejects.toThrow(
      'A non-empty objective is required.',
    );
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
