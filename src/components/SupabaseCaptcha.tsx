import { useEffect, useRef, useState } from 'react';

type CaptchaProvider = 'turnstile' | 'hcaptcha';

interface CaptchaWidgetOptions {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: CaptchaWidgetOptions) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    hcaptcha?: {
      render: (container: HTMLElement, options: CaptchaWidgetOptions) => number;
      reset: (widgetId?: number) => void;
      remove?: (widgetId?: number) => void;
    };
  }
}

const scriptPromises: Partial<Record<CaptchaProvider, Promise<void>>> = {};

function isProviderReady(provider: CaptchaProvider): boolean {
  return provider === 'turnstile'
    ? Boolean(window.turnstile)
    : Boolean(window.hcaptcha);
}

function loadCaptchaScript(provider: CaptchaProvider): Promise<void> {
  if (isProviderReady(provider)) return Promise.resolve();

  const existingPromise = scriptPromises[provider];
  if (existingPromise) return existingPromise;

  const scriptUrl =
    provider === 'turnstile'
      ? 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      : 'https://js.hcaptcha.com/1/api.js?render=explicit';

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.defer = true;
    script.dataset.ryanaiCaptcha = provider;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.onload = () => {
      if (isProviderReady(provider)) {
        resolve();
      } else {
        reject(new Error('The CAPTCHA provider script did not initialize.'));
      }
    };
    script.onerror = () => reject(new Error('The CAPTCHA provider script failed to load.'));
    document.head.appendChild(script);
  }).catch((cause: unknown) => {
    delete scriptPromises[provider];
    throw cause;
  });

  scriptPromises[provider] = promise;
  return promise;
}

interface SupabaseCaptchaProps {
  onToken: (token: string | null) => void;
  resetKey: number;
}

/**
 * Render the CAPTCHA provider configured for Supabase Auth.
 * The site key is public; the provider's secret remains in Supabase Auth settings.
 */
export default function SupabaseCaptcha({
  onToken,
  resetKey,
}: SupabaseCaptchaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<
    { provider: CaptchaProvider; id: string | number } | null
  >(null);
  const onTokenRef = useRef(onToken);
  const [message, setMessage] = useState(
    'Complete the human verification challenge to continue.',
  );

  onTokenRef.current = onToken;

  const rawProvider = import.meta.env.VITE_SUPABASE_CAPTCHA_PROVIDER
    ?.trim()
    .toLowerCase();
  const siteKey = import.meta.env.VITE_SUPABASE_CAPTCHA_SITE_KEY?.trim();
  const provider: CaptchaProvider | null =
    rawProvider === 'turnstile' || rawProvider === 'hcaptcha'
      ? rawProvider
      : null;

  useEffect(() => {
    onTokenRef.current(null);
    widgetRef.current = null;

    if (!provider || !siteKey) return;

    let active = true;
    setMessage('Loading human verification…');

    void loadCaptchaScript(provider)
      .then(() => {
        if (!active || !containerRef.current) return;

        const options: CaptchaWidgetOptions = {
          sitekey: siteKey,
          callback: (token) => {
            onTokenRef.current(token);
            setMessage('Verification completed.');
          },
          'expired-callback': () => {
            onTokenRef.current(null);
            setMessage('Verification expired. Please complete it again.');
          },
          'error-callback': () => {
            onTokenRef.current(null);
            setMessage('Verification failed. Please try again.');
          },
        };

        if (provider === 'turnstile' && window.turnstile) {
          const id = window.turnstile.render(containerRef.current, options);
          widgetRef.current = { provider, id };
        } else if (provider === 'hcaptcha' && window.hcaptcha) {
          const id = window.hcaptcha.render(containerRef.current, options);
          widgetRef.current = { provider, id };
        } else {
          throw new Error('The configured CAPTCHA provider is unavailable.');
        }
        setMessage('Complete the human verification challenge to continue.');
      })
      .catch(() => {
        if (active) {
          onTokenRef.current(null);
          setMessage('Human verification could not load. Refresh the page or contact an administrator.');
        }
      });

    return () => {
      active = false;
      const widget = widgetRef.current;
      if (widget?.provider === 'turnstile' && typeof widget.id === 'string') {
        window.turnstile?.remove(widget.id);
      } else if (widget?.provider === 'hcaptcha' && typeof widget.id === 'number') {
        window.hcaptcha?.remove?.(widget.id);
      }
      widgetRef.current = null;
    };
  }, [provider, siteKey]);

  useEffect(() => {
    if (resetKey === 0) return;
    onTokenRef.current(null);
    const widget = widgetRef.current;
    if (!widget) return;

    if (widget.provider === 'turnstile' && typeof widget.id === 'string') {
      window.turnstile?.reset(widget.id);
    } else if (widget.provider === 'hcaptcha' && typeof widget.id === 'number') {
      window.hcaptcha?.reset(widget.id);
    }
    setMessage('Complete the human verification challenge to continue.');
  }, [resetKey]);

  if (!rawProvider || !siteKey) {
    return (
      <p role="alert" className="text-sm text-amber-200">
        Human verification is not configured for this deployment. Set
        VITE_SUPABASE_CAPTCHA_PROVIDER to turnstile or hcaptcha and provide
        VITE_SUPABASE_CAPTCHA_SITE_KEY.
      </p>
    );
  }

  if (rawProvider !== 'turnstile' && rawProvider !== 'hcaptcha') {
    return (
      <p role="alert" className="text-sm text-amber-200">
        The configured human-verification provider is not supported.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div ref={containerRef} aria-label="Human verification challenge" />
      <p role="status" aria-live="polite" className="text-xs text-slate-400">
        {message}
      </p>
    </div>
  );
}
