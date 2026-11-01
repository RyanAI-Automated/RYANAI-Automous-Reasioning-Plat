import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:tls';
import { test } from 'node:test';
import { redisPing } from './redis-probe.mjs';

test('Redis TLS probe sends exactly one PING after the secure handshake', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ryanai-redis-tls-'));
  try {
    const keyPath = join(directory, 'key.pem');
    const certPath = join(directory, 'cert.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath, '-days', '1',
      '-subj', '/CN=localhost',
    ], { stdio: 'ignore' });

    let requestCount = 0;
    const server = createServer({
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
    }, (socket) => {
      socket.on('data', (chunk) => {
        requestCount += 1;
        assert.match(chunk.toString(), /PING/);
        socket.write('+PONG\\r\\n');
      });
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      await redisPing(`rediss://127.0.0.1:${address.port}`, {
        timeoutMs: 3000,
        tls: { rejectUnauthorized: false },
      });
      assert.equal(requestCount, 1, 'TLS handshake must trigger exactly one RESP request');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
