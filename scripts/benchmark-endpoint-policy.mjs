export function isAllowedInferenceEndpoint(endpoint, allowedInferenceEndpoints) {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    const normalizedHost = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;

    return allowedInferenceEndpoints.some(allowed => {
      const allowedPaths = (allowed.pathPrefixes ?? []).map(path =>
        path === '/' ? '/' : path.replace(/\/$/, '')
      );
      const pathIsAllowed = allowedPaths.some(path =>
        url.pathname === path || (path !== '/' && url.pathname === `${path}/`)
      );
      return url.protocol === `${allowed.protocol}:` &&
        normalizedHost === allowed.host.toLowerCase() &&
        url.port === String(allowed.port) &&
        pathIsAllowed &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash;
    });
  } catch {
    return false;
  }
}
