// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SupabaseCaptcha from './SupabaseCaptcha';

interface CaptchaTestOptions {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
}

type TurnstileTestApi = {
  render: (container: HTMLElement, options: CaptchaTestOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

type HCaptchaTestApi = {
  render: (container: HTMLElement, options: CaptchaTestOptions) => number;
  reset: (widgetId?: number) => void;
  remove: (widgetId?: number) => void;
};

let container: HTMLDivElement;
let root: Root | null = null;
const testWindow = window as unknown as {
  turnstile?: TurnstileTestApi;
  hcaptcha?: HCaptchaTestApi;
};

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_CAPTCHA_PROVIDER', 'turnstile');
  vi.stubEnv('VITE_SUPABASE_CAPTCHA_SITE_KEY', 'public-test-site-key');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  delete testWindow.turnstile;
  delete testWindow.hcaptcha;
  container.remove();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it('renders Turnstile, passes its token, clears expired tokens, resets, and removes the widget', async () => {
  let options: CaptchaTestOptions | null = null;
  const render = vi.fn((_container: HTMLElement, value: CaptchaTestOptions) => {
    options = value;
    return 'turnstile-widget';
  });
  const reset = vi.fn();
  const remove = vi.fn();
  testWindow.turnstile = { render, reset, remove };
  const onToken = vi.fn();

  await act(async () => {
    root?.render(<SupabaseCaptcha onToken={onToken} resetKey={0} />);
  });
  await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
  expect(render.mock.calls[0][1].sitekey).toBe('public-test-site-key');

  await act(async () => options?.callback('turnstile-token'));
  expect(onToken).toHaveBeenLastCalledWith('turnstile-token');

  await act(async () => options?.['expired-callback']());
  expect(onToken).toHaveBeenLastCalledWith(null);

  await act(async () => {
    root?.render(<SupabaseCaptcha onToken={onToken} resetKey={1} />);
  });
  expect(reset).toHaveBeenCalledWith('turnstile-widget');

  await act(async () => root?.unmount());
  root = null;
  expect(remove).toHaveBeenCalledWith('turnstile-widget');
});

it('supports hCaptcha using its numeric widget identifier', async () => {
  vi.stubEnv('VITE_SUPABASE_CAPTCHA_PROVIDER', 'hcaptcha');
  let options: CaptchaTestOptions | null = null;
  const render = vi.fn((_container: HTMLElement, value: CaptchaTestOptions) => {
    options = value;
    return 7;
  });
  const reset = vi.fn();
  const remove = vi.fn();
  testWindow.hcaptcha = { render, reset, remove };
  const onToken = vi.fn();

  await act(async () => {
    root?.render(<SupabaseCaptcha onToken={onToken} resetKey={0} />);
  });
  await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
  await act(async () => options?.callback('hcaptcha-token'));
  expect(onToken).toHaveBeenLastCalledWith('hcaptcha-token');

  await act(async () => {
    root?.render(<SupabaseCaptcha onToken={onToken} resetKey={1} />);
  });
  expect(reset).toHaveBeenCalledWith(7);

  await act(async () => root?.unmount());
  root = null;
  expect(remove).toHaveBeenCalledWith(7);
});

it('fails closed when the provider or public site key is missing', async () => {
  vi.stubEnv('VITE_SUPABASE_CAPTCHA_PROVIDER', '');
  vi.stubEnv('VITE_SUPABASE_CAPTCHA_SITE_KEY', '');
  await act(async () => {
    root?.render(<SupabaseCaptcha onToken={vi.fn()} resetKey={0} />);
  });
  expect(container.querySelector('[role=alert]')?.textContent).toContain(
    'not configured',
  );
});
