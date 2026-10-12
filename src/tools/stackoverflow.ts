import axios from 'axios';

export interface StackOverflowQueryPayload {
  query: string;
  tags?: string[];
  page?: number;
  pageSize?: number;
}

export interface StackOverflowQueryResult {
  success: boolean;
  data: unknown;
  error?: string;
}

const SO_AGENTS_BASE_URL = 'https://agents.stackoverflow.com/v1';

/**
 * Query Stack Overflow Agents with an optional bearer token and a 10-second timeout.
 * Request failures become { success: false, data: null, error }, preferring a provider
 * message when present.
 */
export async function queryStackOverflow(
  payload: StackOverflowQueryPayload,
  apiToken?: string
): Promise<StackOverflowQueryResult> {
  try {
    const response = await axios.post(
      `${SO_AGENTS_BASE_URL}/query`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          ...(apiToken && { Authorization: `Bearer ${apiToken}` }),
        },
        timeout: 10000,
      }
    );

    return {
      success: true,
      data: response.data,
    };
  } catch (err: unknown) {
    const responseData = axios.isAxiosError<unknown>(err) ? err.response?.data : undefined;
    const responseMessage = responseData !== null && typeof responseData === 'object' &&
      'message' in responseData && typeof responseData.message === 'string'
      ? responseData.message
      : undefined;
    return {
      success: false,
      data: null,
      error: responseMessage || (err instanceof Error ? err.message : String(err)) || 'Unknown network error',
    };
  }
}
