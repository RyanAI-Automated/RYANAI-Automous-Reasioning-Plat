import type { IncomingMessage, ServerResponse } from 'node:http';

type VercelRequest = IncomingMessage & { method?: string };
type VercelResponse = ServerResponse;

function respond(response: VercelResponse, status: number, payload: Record<string, unknown>) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(payload));
}

/** Authenticated, stateless Vercel Function -> bridge capability heartbeat. */
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    return respond(response, 405, { error: 'Method not allowed.' });
  }

  const origin = request.headers.origin;
  const forwardedHost = request.headers['x-forwarded-host'];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || request.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return respond(response, 403, { error: 'Origin is not allowed.' });
    } catch {
      return respond(response, 403, { error: 'Origin is not allowed.' });
    }
  }

  const authorization = request.headers.authorization;
  const accessToken = typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : '';
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const bridgeUrl = (process.env.BRIDGE_INTERNAL_URL || '').replace(/\/+$/, '');
  const adapterToken = process.env.BRIDGE_VERCEL_ADAPTER_TOKEN || '';

  if (!accessToken || accessToken.length > 8192) return respond(response, 401, { error: 'A signed-in session is required.' });
  if (!supabaseUrl || !publishableKey || !bridgeUrl || adapterToken.length < 32) {
    return respond(response, 503, { error: 'Vercel connectivity adapter is not configured.' });
  }
  try {
    const bridgeOrigin = new URL(bridgeUrl);
    if (bridgeOrigin.pathname !== '/' || (process.env.NODE_ENV === 'production' && bridgeOrigin.protocol !== 'https:')) {
      return respond(response, 503, { error: 'Vercel bridge URL must be an HTTPS origin.' });
    }
  } catch {
    return respond(response, 503, { error: 'Vercel bridge URL is invalid.' });
  }

  try {
    const auth = await fetch(supabaseUrl + '/auth/v1/user', {
      headers: { apikey: publishableKey, authorization: 'Bearer ' + accessToken },
      signal: AbortSignal.timeout(4000),
    });
    if (!auth.ok) return respond(response, auth.status >= 500 ? 503 : 401, { error: 'Supabase session validation failed.' });
    const user = await auth.json() as { id?: string; is_anonymous?: boolean };
    if (!user.id || user.is_anonymous) return respond(response, 401, { error: 'A non-anonymous signed-in session is required.' });

    const bridge = await fetch(bridgeUrl + '/internal/adapters/vercel/heartbeat', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + adapterToken },
      signal: AbortSignal.timeout(4000),
    });
    if (!bridge.ok) return respond(response, 503, { error: 'Connectivity bridge is unavailable.' });
    return respond(response, 200, { status: 'ready', adapter: 'vercel' });
  } catch {
    return respond(response, 503, { error: 'Vercel connectivity adapter is unavailable.' });
  }
}
