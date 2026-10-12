import WebSocket from 'ws';

/** Check upgrades or an exact HTTP rejection without putting credentials in URLs. */
export async function checkWebSocket(
  apiUrl: string,
  timeoutMs: number,
  options: { token?: string; expectedStatus?: number } = {},
): Promise<void> {
  const url = new URL('/ws', apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: options.token
        ? { Authorization: `Bearer ${options.token}` }
        : {},
      followRedirects: false,
    });
    let settled = false;
    /** Settle the check once, clearing its timer and terminating the socket. */
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.terminate();
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(
      () => finish(new Error(`WebSocket check timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    socket.once('open', () =>
      finish(
        options.expectedStatus
          ? new Error(
              `Expected HTTP ${options.expectedStatus}, received WebSocket upgrade`,
            )
          : undefined,
      ),
    );
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      finish(
        response.statusCode === options.expectedStatus
          ? undefined
          : new Error(
              `Expected ${options.expectedStatus ? `HTTP ${options.expectedStatus}` : 'WebSocket upgrade'}, received HTTP ${response.statusCode}`,
            ),
      );
    });
    // Keep this listener installed: terminating a pending handshake emits an error.
    socket.on('error', () => finish(new Error('WebSocket connection failed')));
  });
}
