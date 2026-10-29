/**
 * Resolve an MCP health-check target without allowing callers to turn the tool
 * into an arbitrary HTTP client. Overrides must match the configured health
 * endpoint's origin and path; query strings and fragments are never accepted.
 */
export function resolveHealthUrl(requestedUrl, configuredUrl) {
  const configured = parseHealthUrl(configuredUrl, 'Configured health URL');
  const requested = parseHealthUrl(requestedUrl || configured.href, 'Health URL');

  if (requested.origin !== configured.origin || requested.pathname !== configured.pathname) {
    throw new Error('Health URL must match the configured API health endpoint.');
  }
  return requested;
}

function parseHealthUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL.`);
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${label} must be an HTTP(S) URL without credentials, query, or fragment.`);
  }
  return parsed;
}
