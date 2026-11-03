import { useEffect, useRef, useState } from 'react';

type CaptchaProvider = 'hcaptcha' | 'turnstile';
type CaptchaStatus = 'loading' | 'ready' | 'verified' | 'configuration' | 'error';

interface CaptchaOptions {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
}

interface CaptchaApi {
  render(container: HTMLElement, options: CaptchaOptions): string;
  reset(widgetId?: string): void;
  remove?(widgetId: string): void;
}

declare global {
  interface Window {
    hcaptcha?: CaptchaApi;
    turnstile?: CaptchaApi;
  }
}

interface CaptchaChallengeProps {
  provider: string;
  siteKey: string;
  onToken: (token: string | null) => void;
  resetSignal: number;
}

interface ActiveWidget {
  provider: CaptchaProvider;
  id: string;
}

const SCRIPT_URLS: Record<CaptchaProvider, string> = {
  hcaptcha: 'https://js.hcaptcha.com/1/api.js?render=explicit',
  turnstile:
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
};

/**
 * Render the provider configured in Supabase Auth. The site key is public
 * frontend configuration; the corresponding secret stays in Supabase.
 */
export default function CaptchaChallenge({
  provider,
  siteKey,
  onToken,
  resetSignal,
}: CaptchaChallengeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<ActiveWidget | null>(null);
  const onTokenRef = useRef(onToken);
  const lastResetSignal = useRef(resetSignal);
  const [status, setStatus] = useState<CaptchaStatus>('loading');

  onTokenRef.current = onToken;

  useEffect(() => {
    const normalizedProvider = provider.trim().toLowerCase();
    if (
      (normalizedProvider !== 'hcaptcha' &&
        normalizedProvider !== 'turnstile') ||
      !siteKey.trim()
    ) {
      setStatus('configuration');
      onTokenRef.current(null);
      return;
    }

    const selectedProvider = normalizedProvider as CaptchaProvider;
    let active = true;
    let script: HTMLScriptElement | null = null;

    const getApi = (): CaptchaApi | undefined =>
      selectedProvider === 'hcaptcha' ? window.hcaptcha : window.turnstile;

    const handleToken = (token: string) => {
      if (!active) return;
      setStatus('verified');
      onTokenRef.current(token);
    };

    const handleExpired = () => {
      if (!active) return;
      setStatus('ready');
      onTokenRef.current(null);
    };

    const handleError = () => {
      if (!active) return;
      setStatus('error');
      onTokenRef.current(null);
    };

    const renderWidget = () => {
      if (!active || !containerRef.current) return;
      const api = getApi();
      if (!api) {
        handleError();
        return;
      }

      try {
        const id = api.render(containerRef.current, {
          sitekey: siteKey.trim(),
          callback: handleToken,
          'expired-callback': handleExpired,
          'error-callback': handleError,
        });
        widgetRef.current = { provider: selectedProvider, id };
        setStatus('ready');
      } catch {
        handleError();
      }
    };

    const handleScriptLoad = () => {
      if (script) script.dataset.loaded = 'true';
      renderWidget();
    };

    const handleScriptError = () => handleError();

    const scriptId = 'ryanai-' + selectedProvider + '-captcha-script';
    script = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (getApi()) {
      renderWidget();
    } else if (script) {
      script.addEventListener('load', handleScriptLoad, { once: true });
      script.addEventListener('error', handleScriptError, { once: true });
      if (script.dataset.loaded === 'true') {
        renderWidget();
      }
    } else {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = SCRIPT_URLS[selectedProvider];
      script.async = true;
      script.defer = true;
      script.addEventListener('load', handleScriptLoad, { once: true });
      script.addEventListener('error', handleScriptError, { once: true });
      document.head.appendChild(script);
    }

    onTokenRef.current(null);

    return () => {
      active = false;
      script?.removeEventListener('load', handleScriptLoad);
      script?.removeEventListener('error', handleScriptError);
      const widget = widgetRef.current;
      if (widget?.provider === selectedProvider) {
        getApi()?.remove?.(widget.id);
        widgetRef.current = null;
      }
      containerRef.current?.replaceChildren();
    };
  }, [provider, siteKey]);

  useEffect(() => {
    if (lastResetSignal.current === resetSignal) return;
    lastResetSignal.current = resetSignal;
    onTokenRef.current(null);

    const widget = widgetRef.current;
    if (!widget) return;
    if (widget.provider === 'hcaptcha') {
      window.hcaptcha?.reset(widget.id);
    } else {
      window.turnstile?.reset(widget.id);
    }
    setStatus('ready');
  }, [resetSignal]);

  const normalizedProvider = provider.trim().toLowerCase();
  if (
    !siteKey.trim() ||
    (normalizedProvider !== 'hcaptcha' && normalizedProvider !== 'turnstile')
  ) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-amber-400/30 p-3 text-sm text-amber-200"
      >
        CAPTCHA is required, but this deployment is missing its matching
        provider or public site key. Contact your administrator.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div ref={containerRef} aria-label="CAPTCHA verification challenge" />
      <p aria-live="polite" className="text-xs text-slate-400">
        {status === 'loading'
          ? 'Loading CAPTCHA challenge…'
          : status === 'verified'
            ? 'CAPTCHA verified.'
            : status === 'error'
              ? 'CAPTCHA could not load. Refresh the page and try again.'
              : 'Complete the CAPTCHA challenge to continue.'}
      </p>
    </div>
  );
}
