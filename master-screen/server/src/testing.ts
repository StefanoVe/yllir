// Test helpers: a real HTTP server on a free loopback port and a raw request helper
// that can set any Host header. Used only by *.test.ts files.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: unknown;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

/** Starts a server on 127.0.0.1 with a free port. makeListener receives that port. */
export async function startServer(
  makeListener: (port: number) => http.RequestListener,
): Promise<RunningServer> {
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  server.on('request', makeListener(port));
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function request(
  port: number,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path ?? '/', headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}
