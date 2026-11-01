import net from 'node:net';
import tls from 'node:tls';

/**
 * Send a Redis PING over TCP or TLS and wait for the RESP PONG.
 * TLS verification remains enabled by default; tests may inject local CA options.
 */
export function redisPing(connectionUrl, options = {}) {
  const parsed = new URL(connectionUrl);
  const secure = parsed.protocol === 'rediss:';
  const port = Number(parsed.port || 6379);
  const commands = [];

  if (parsed.password) {
    commands.push(
      parsed.username
        ? ['AUTH', decodeURIComponent(parsed.username), decodeURIComponent(parsed.password)]
        : ['AUTH', decodeURIComponent(parsed.password)],
    );
  }
  const db = parsed.pathname.replace(/^\//, '');
  if (db && db !== '0') commands.push(['SELECT', db]);
  commands.push(['PING']);

  const request = commands.map((parts) =>
    \`*\${parts.length}\r\n\${parts.map((part) => \`$\${Buffer.byteLength(part)}\r\n\${part}\r\n\`).join('')}\`,
  ).join('');

  return new Promise((resolve, reject) => {
    let settled = false;
    let response = '';
    const socket = secure
      ? tls.connect({ host: parsed.hostname, port, servername: parsed.hostname, ...options.tls })
      : net.createConnection({ host: parsed.hostname, port });

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    const timer = setTimeout(
      () => finish(new Error('Redis connection or PING timed out')),
      options.timeoutMs ?? 5000,
    );

    socket.once(secure ? 'secureConnect' : 'connect', () => socket.write(request));
    socket.on('data', (chunk) => {
      response += chunk.toString();
      if (response.includes('-ERR')) finish(new Error(\`Redis error: \${response.trim()}\`));
      else if (response.includes('+PONG')) finish();
    });
    socket.once('error', (error) => {
      if (error.code === 'ETIMEDOUT') finish(new Error('Redis connection or PING timed out'));
      else finish(error);
    });
  });
}
