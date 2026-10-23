// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AuthPage from './AuthPage';

const mock = vi.hoisted(() => ({
  configured: true,
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mock.configured ? { auth: mock } : null;
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  mock.configured = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function fill(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
it('authenticates with normalized email and password', async () => {
  mock.signInWithPassword.mockResolvedValue({
    data: { session: {} },
    error: null,
  });
  await act(async () => root.render(<AuthPage />));
  await fill('[type=email]', 'Alice@Example.com');
  await fill('[type=password]', 'correct-password');
  await submit();
  expect(mock.signInWithPassword).toHaveBeenCalledWith({
    email: 'alice@example.com',
    password: 'correct-password',
  });
});
it('shows server rejection and never offers demo authentication', async () => {
  mock.signInWithPassword.mockResolvedValue({
    data: {},
    error: new Error('Invalid login credentials'),
  });
  await act(async () => root.render(<AuthPage />));
  await fill('[type=email]', 'alice@example.com');
  await fill('[type=password]', 'wrong-password');
  await submit();
  expect(container.querySelector('[role=alert]')?.textContent).toContain(
    'Invalid login credentials',
  );
  expect(container.textContent).not.toContain('Try Demo');
  expect(container.textContent).not.toContain('GitHub');
});
it('keeps confirmation-required signups on the public screen', async () => {
  mock.signUp.mockResolvedValue({ data: { session: null }, error: null });
  await act(async () => root.render(<AuthPage mode="signup" />));
  await fill('[type=email]', 'alice@example.com');
  await fill('[autocomplete=name]', 'Alice');
  await fill('[type=password]', 'correct-password');
  await fill('label:last-of-type input', 'correct-password');
  await submit();
  expect(mock.signUp).toHaveBeenCalledWith({
    email: 'alice@example.com',
    password: 'correct-password',
    options: { data: { full_name: 'Alice' } },
  });
  expect(container.querySelector('[role=status]')?.textContent).toContain(
    'Check your email',
  );
  expect(
    container.querySelector<HTMLInputElement>('[type=password]')!.value,
  ).toBe('');
});
it('rejects mismatched passwords without calling the provider', async () => {
  await act(async () => root.render(<AuthPage mode="signup" />));
  await fill('[type=email]', 'alice@example.com');
  await fill('[type=password]', 'correct-password');
  await fill('label:last-of-type input', 'different-password');
  await submit();
  expect(mock.signUp).not.toHaveBeenCalled();
  expect(container.querySelector('[role=alert]')?.textContent).toContain(
    'Passwords do not match',
  );
});
it('disables authentication when configuration is absent', async () => {
  mock.configured = false;
  await act(async () => root.render(<AuthPage />));
  expect(container.querySelector('[role=alert]')?.textContent).toContain(
    'has not been configured',
  );
  expect(container.querySelector('form')).toBeNull();
});
