import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { scanWithClamAv } from './scanner';

const originalHost = process.env.CLAMAV_HOST;
const originalPort = process.env.CLAMAV_PORT;
const originalTimeout = process.env.CLAMAV_TIMEOUT_MS;

afterEach(() => {
  if (originalHost === undefined) delete process.env.CLAMAV_HOST;
  else process.env.CLAMAV_HOST = originalHost;
  if (originalPort === undefined) delete process.env.CLAMAV_PORT;
  else process.env.CLAMAV_PORT = originalPort;
  if (originalTimeout === undefined) delete process.env.CLAMAV_TIMEOUT_MS;
  else process.env.CLAMAV_TIMEOUT_MS = originalTimeout;
});

async function withClamAvReply(reply: string, run: (port: number, received: Buffer[]) => Promise<void>) {
  const received: Buffer[] = [];
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      received.push(Buffer.from(chunk));
      const request = Buffer.concat(received);
      if (request.length >= 4 && request.subarray(-4).every((byte) => byte === 0)) socket.end(reply);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('ClamAV test server did not bind a TCP port.');
  try {
    await run(address.port, received);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('ClamAV INSTREAM protocol', () => {
  it('sends a length-prefixed stream and accepts a clean response', async () => {
    await withClamAvReply('stream: OK\\0', async (port, received) => {
      process.env.CLAMAV_HOST = '127.0.0.1';
      process.env.CLAMAV_PORT = String(port);
      await expect(scanWithClamAv(new TextEncoder().encode('safe attachment'))).resolves.toBe('clean');
      const request = Buffer.concat(received);
      expect(request.subarray(0, 10)).toEqual(Buffer.from('zINSTREAM\\0'));
      expect(request.includes(Buffer.from('safe attachment'))).toBe(true);
    });
  });

  it('returns infected when ClamAV reports a complete detection response', async () => {
    await withClamAvReply('stream: test-signature FOUND\\0', async (port) => {
      process.env.CLAMAV_HOST = '127.0.0.1';
      process.env.CLAMAV_PORT = String(port);
      await expect(scanWithClamAv(new TextEncoder().encode('test payload'))).resolves.toBe('infected');
    });
  });

  it('rejects malformed timeout configuration before opening a socket', async () => {
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = '1';
    process.env.CLAMAV_TIMEOUT_MS = 'not-a-number';
    await expect(scanWithClamAv(new TextEncoder().encode('payload'))).rejects.toThrow(
      'CLAMAV_TIMEOUT_MS must be an integer between 1000 and 300000.',
    );
  });

  it('rejects payloads above the enforced 20 MiB upload limit', async () => {
    process.env.CLAMAV_HOST = '127.0.0.1';
    await expect(scanWithClamAv(new Uint8Array(20 * 1024 * 1024 + 1))).rejects.toThrow(
      'Attachment size is outside the scanner limit.',
    );
  });

  it('rejects empty payloads', async () => {
    process.env.CLAMAV_HOST = '127.0.0.1';
    await expect(scanWithClamAv(new Uint8Array())).rejects.toThrow(
      'Attachment size is outside the scanner limit.',
    );
  });
});
