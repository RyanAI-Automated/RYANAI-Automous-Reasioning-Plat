type ProviderErrorShape = {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  response?: { status?: unknown };
};

const SAFE_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ERR_CANCELED',
  'ABORT_ERR',
]);

/**
 * Convert an untrusted SDK/provider exception into a deliberately small,
 * credential-safe diagnostic. Provider response bodies and raw messages are
 * never persisted or returned to callers.
 */
export function summarizeProviderError(error: unknown): string {
  const detail = error && typeof error === 'object'
    ? error as ProviderErrorShape
    : {};
  const status = [
    detail.status,
    detail.statusCode,
    detail.response?.status,
  ].find((value) => typeof value === 'number' && Number.isInteger(value)) as number | undefined;

  if (status === 401 || status === 403) {
    return 'Provider authentication or authorization failed (HTTP ' + status + '). Check this brain\'s endpoint and credential.';
  }
  if (status === 408 || status === 504 || detail.name === 'TimeoutError') {
    return 'Provider request timed out.';
  }
  if (status === 429) return 'Provider rate limit reached (HTTP 429).';
  if (status !== undefined && status >= 500) {
    return 'Provider service is unavailable (HTTP ' + status + ').';
  }
  if (status !== undefined && status >= 400) {
    return 'Provider rejected the request (HTTP ' + status + '). Check the model and request configuration.';
  }
  if (typeof detail.code === 'string' && SAFE_NETWORK_CODES.has(detail.code)) {
    return 'Provider network request failed (' + detail.code + '). Check endpoint reachability.';
  }
  if (detail.name === 'AbortError' || detail.name === 'CanceledError') {
    return 'Provider request was cancelled.';
  }
  return 'Provider request failed. Detailed provider response omitted to protect credentials.';
}
