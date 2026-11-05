const ALLOWED_PATHS = new Set(['', '/', '/v1', '/v1/']);

export function isAllowedInferenceEndpoint(endpoint, allowedInferenceEndpoints) {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    const normalizedHost = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
    return allowedInferenceEndpoints.some(allowed =>
      url.protocol === `${allowed.protocol}:` &&
      normalizedHost === allowed.host.toLowerCase() &&
      url.port === String(allowed.port) &&
      ALLOWED_PATHS.has(url.pathname) &&
      !url.username && !url.password && !url.search && !url.hash
    );
  } catch {
    return false;
  }
}
