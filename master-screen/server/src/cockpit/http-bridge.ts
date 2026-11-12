// Bridge between the cockpit's Web handlers ((Request) => Promise<Response>) and Express.
// The request is rebuilt from the raw Node stream (so it must be mounted before express.json),
// and the Response is written chunk by chunk with a flush after each chunk, so SSE streams.
// The Request signal aborts when the client disconnects.
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { RequestHandler } from "express";

/** A Web handler; null means "not mine", and the request continues to the next Express handler. */
export type WebHandler = (request: Request) => Promise<Response | null>;

const BODYLESS = new Set(["GET", "HEAD"]);

/** Builds the Web Request for a Node request. The URL always points at the loopback address. */
export function toWebRequest(
  req: IncomingMessage,
  signal: AbortSignal,
): Request {
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }
  const target = (req as { originalUrl?: string }).originalUrl ?? req.url ?? "/";
  const init: RequestInit & { duplex?: "half" } = { method, headers, signal };
  if (!BODYLESS.has(method.toUpperCase())) {
    init.body = Readable.toWeb(req) as unknown as ReadableStream;
    init.duplex = "half";
  }
  return new Request(new URL(target, "http://127.0.0.1"), init);
}

/** Writes a Web Response to a Node response: status, headers, then the body chunk by chunk. */
export async function writeWebResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  res.flushHeaders();
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  const cancel = () => void reader.cancel().catch(() => {});
  res.once("close", cancel);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (res.destroyed) break;
      if (!res.write(value)) {
        // Wait for the socket to drain, but never past the client going away.
        await new Promise<void>((resolve) => {
          const release = () => resolve();
          res.once("drain", release);
          res.once("close", release);
        });
      }
    }
  } finally {
    res.removeListener("close", cancel);
    if (!res.writableEnded) res.end();
  }
}

/** Express middleware that answers with a Web handler; calls next() when the handler declines. */
export function webHandlerMiddleware(handler: WebHandler): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableFinished) controller.abort();
      });
      try {
        const response = await handler(toWebRequest(req, controller.signal));
        if (!response) {
          next();
          return;
        }
        await writeWebResponse(res, response);
      } catch (error) {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };
}

/** A plain Node server answering with a Web handler, for tests that need a real socket. */
export function webHandlerServer(handler: (request: Request) => Promise<Response>) {
  return http.createServer((req, res) => {
    void (async () => {
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableFinished) controller.abort();
      });
      try {
        await writeWebResponse(res, await handler(toWebRequest(req, controller.signal)));
      } catch (error) {
        if (!res.headersSent) res.statusCode = 500;
        res.end(String(error));
      }
    })();
  });
}
