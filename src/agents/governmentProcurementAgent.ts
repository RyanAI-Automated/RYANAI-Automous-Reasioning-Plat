export interface GovernmentProcurementRequest {
  query: string;
  apiUrl?: string;
  limit?: number;
}

export interface GovernmentProcurementResult {
  agentName: 'RyanAI South African Government Procurement Agent';
  mode: 'public-data-only';
  query: string;
  status: 'SOURCE_DISCOVERY' | 'DATA_RETRIEVED' | 'BLOCKED' | 'UNCONFIGURED';
  sources: Array<{ name: string; url: string; access: 'public' | 'authorised-only'; note: string }>;
  records: unknown[];
  message: string;
}

const SOURCES = [
  { name: 'National Treasury Transparency Portal', url: 'https://data.etenders.gov.za/', access: 'public' as const, note: 'Public procurement dashboards and OCDS downloads/API.' },
  { name: 'eTender Publication Portal', url: 'https://www.etenders.gov.za/home/opportunities', access: 'public' as const, note: 'Public tender notices, corrigenda, awards and tender documents.' },
  { name: 'Central Supplier Database', url: 'https://secure.csd.gov.za/', access: 'authorised-only' as const, note: 'Supplier self-service; use only the supplier account holder’s authorised access. No scraping or credential automation.' },
  { name: 'National Treasury OCPO', url: 'https://ocpo.treasury.gov.za/', access: 'public' as const, note: 'Procurement policy, guidance and supplier resources.' },
];

const ALLOWED_API_HOSTS = new Set(['ocds-api.etenders.gov.za', 'data.etenders.gov.za']);
const MAX_RESPONSE_BYTES = 2_000_000;

function safeApiUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !ALLOWED_API_HOSTS.has(url.hostname) || url.username || url.password) {
    throw new Error('Government data API must use HTTPS on an explicitly approved National Treasury public-data host.');
  }
  return url;
}

export async function runGovernmentProcurementAgent(
  request: GovernmentProcurementRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<GovernmentProcurementResult> {
  const query = request.query.trim().slice(0, 300);
  if (!query) throw new Error('A procurement search query is required.');

  if (!request.apiUrl) {
    return {
      agentName: 'RyanAI South African Government Procurement Agent',
      mode: 'public-data-only',
      query,
      status: 'SOURCE_DISCOVERY',
      sources: SOURCES,
      records: [],
      message: 'Public sources identified. Configure ZA_GOV_PROCUREMENT_API_URL with a documented OCDS API endpoint from the National Treasury OpenAPI specification to retrieve structured records. CSD and other authenticated supplier systems are not scraped.',
    };
  }

  const url = safeApiUrl(request.apiUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(Math.max(1, Math.min(100, request.limit ?? 25))));
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`National Treasury public API returned HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error('Government API response exceeds the 2 MB safety limit.');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Government API response exceeds the 2 MB safety limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Government API returned non-JSON content.'); }
  const records = Array.isArray(parsed) ? parsed.slice(0, 100) :
    typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { releases?: unknown }).releases)
      ? (parsed as { releases: unknown[] }).releases.slice(0, 100)
      : [parsed];
  return {
    agentName: 'RyanAI South African Government Procurement Agent',
    mode: 'public-data-only',
    query,
    status: 'DATA_RETRIEVED',
    sources: SOURCES,
    records,
    message: `Retrieved ${records.length} public record(s). Verify tender status, closing date and official documents on the issuing entity's portal before acting.`,
  };
}

export const ZA_GOVERNMENT_PROCUREMENT_SKILL = Object.freeze({
  id: 'za-government-procurement',
  name: 'South African Government Procurement Intelligence',
  version: '1.0.0',
  mode: 'public-data-only',
  capabilities: ['tender-discovery', 'OCDS-public-data', 'procurement-analysis', 'supplier-readiness'],
  forbidden: ['private-database-access', 'credential-harvesting', 'portal-bypass', 'automated-bid-submission'],
});
