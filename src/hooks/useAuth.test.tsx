// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from './useAuth';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));

const session = { user: { id: 'alice', is_anonymous: false } } as Session;
type Restoration = { data: { session: Session | null }; error: Error | null };
let state: ReturnType<typeof useAuth>;
let listener: (event: AuthChangeEvent, session: Session | null) => void;
let root: Root;
let container: HTMLDivElement;

function Probe() {
  state = useAuth();
  return null;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  auth.getSession.mockResolvedValue({ data: { session }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
  auth.onAuthStateChange.mockImplementation((callback) => {
    listener = callback;
    return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => root.render(<Probe />));
}

describe('authentication state races and failures', () => {
  it.each(['resolve', 'reject'])(
    'preserves a newer sign-in when delayed restoration finishes with %s',
    async (completion) => {
      let restore!: (value: Restoration) => void;
      let fail!: (reason: Error) => void;
      auth.getSession.mockReturnValue(
        new Promise<Restoration>((resolve, reject) => {
          restore = resolve;
          fail = reject;
        }),
      );
      await mount();
      expect(state.loading).toBe(true);
      await act(async () => listener('SIGNED_IN', session));
      await act(async () => {
        if (completion === 'resolve')
          restore({ data: { session: null }, error: null });
        else fail(new Error('stale restoration failure'));
      });
      expect(state).toMatchObject({ session, loading: false, error: null });
    },
  );

  it('fails closed on a returned restoration error and clears it on a later auth event', async () => {
    auth.getSession.mockResolvedValue({
      data: { session },
      error: new Error('expired'),
    });
    await mount();
    expect(state).toMatchObject({ session: null, loading: false });
    expect(state.error).toContain('Unable to restore');
    await act(async () => listener('SIGNED_IN', session));
    expect(state).toMatchObject({ session, error: null });
  });

  it.each(['resolve', 'reject'])(
    'unsubscribes and ignores restoration and auth events after unmount (%s)',
    async (completion) => {
      let restore!: (value: Restoration) => void;
      let fail!: (reason: Error) => void;
      auth.getSession.mockReturnValue(
        new Promise<Restoration>((resolve, reject) => {
          restore = resolve;
          fail = reject;
        }),
      );
      await mount();
      const beforeUnmount = state;
      await act(async () => root.unmount());
      await act(async () => {
        listener('SIGNED_IN', session);
        if (completion === 'resolve')
          restore({ data: { session }, error: null });
        else fail(new Error('offline'));
      });
      expect(auth.unsubscribe).toHaveBeenCalledOnce();
      expect(state).toBe(beforeUnmount);
    },
  );

  it('keeps the session while sign-out is pending and clears it only after success', async () => {
    let finish!: (value: { error: null }) => void;
    auth.signOut.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await mount();
    let outcome!: Promise<boolean>;
    await act(async () => {
      outcome = state.signOut();
    });
    expect(state).toMatchObject({ session, signingOut: true, error: null });
    await act(async () => {
      finish({ error: null });
      await outcome;
    });
    expect(await outcome).toBe(true);
    expect(state).toMatchObject({
      session: null,
      signingOut: false,
      error: null,
    });
  });

  it.each(['resolve', 'reject'])(
    'retains the session after sign-out failure (%s) and permits a successful retry',
    async (completion) => {
      const error = new Error('provider unavailable');
      if (completion === 'resolve')
        auth.signOut.mockResolvedValueOnce({ error });
      else auth.signOut.mockRejectedValueOnce(error);
      await mount();
      await act(async () => {
        expect(await state.signOut()).toBe(false);
      });
      expect(state).toMatchObject({
        session,
        signingOut: false,
        error: 'Sign out failed. Please try again.',
      });
      await act(async () => {
        expect(await state.signOut()).toBe(true);
      });
      expect(state).toMatchObject({
        session: null,
        signingOut: false,
        error: null,
      });
    },
  );
});
