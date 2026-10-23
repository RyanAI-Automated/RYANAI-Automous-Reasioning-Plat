import { execFileSync } from 'node:child_process';
import http from 'node:http';

const listenHost = '127.0.0.1';
const listenPort = 1420;
const targetHost = '127.0.0.1';
const targetPort = 9090;
function clearPort() {
  if (process.platform !== 'win32') return;
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue).OwningProcess'], { encoding: 'utf8' });
    for (const value of output.split(/\s+/).filter(Boolean)) {
      const pid = Number(value);
      if (pid && pid !== process.pid) execFileSync('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`]);
    }
  } catch {
    // The listener will report any remaining conflict.
  }
}

clearPort();

function proxyRequest(request, response) {
  const upstream = http.request({
    hostname: targetHost,
    port: targetPort,
    method: request.method,
    path: request.url,
    headers: {
      ...request.headers,
      host: `${targetHost}:${targetPort}`,
      connection: 'close',
    },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });

  upstream.on('error', (error) => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
    response.end(`Docker web proxy error: ${error.message}`);
  });
  request.pipe(upstream);
}

const server = http.createServer(proxyRequest);

server.on('upgrade', (request, socket, head) => {
  socket.destroy();
});

server.listen(listenPort, listenHost, () => {
  console.log(`Docker web mirror: http://${listenHost}:${listenPort} -> http://${targetHost}:${targetPort}`);
});
