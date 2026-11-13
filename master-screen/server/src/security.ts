// Host check, Origin check on state-changing requests, and security headers.
// Owner: server skeleton. Applied to every request before anything else.
import type { RequestHandler } from 'express';

export interface CspOptions {
  /** The encyclopedia module is on: the reader embeds the same-origin built site (`frame-src 'self'`). */
  encyclopedia?: boolean;
}

/**
 * The Content-Security-Policy. Music plays on the server, so no third-party script, frame or
 * connection is allowed. The only third-party host is the YouTube thumbnail host, for images.
 * The same-origin built encyclopedia is framed when that module is on.
 */
export function buildCsp({ encyclopedia = false }: CspOptions = {}): string {
  // One frame-src directive for every module that frames something.
  const frames = encyclopedia ? ["'self'"] : [];
  const frameSrc = frames.length > 0 ? [`frame-src ${frames.join(' ')}`] : [];
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // Artwork of the YouTube tracks only (thumbnails). No script, style, frame or connect host.
    "img-src 'self' data: https://i.ytimg.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...frameSrc,
  ].join('; ');
}

export const CONTENT_SECURITY_POLICY = buildCsp();

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

export function allowedOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  return allowedHosts(port).includes(host.toLowerCase());
}

/** A request without Origin (same-origin GET, curl) is allowed; a present Origin must match. */
export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  return allowedOrigins(port).includes(origin.toLowerCase());
}

export function isStateChanging(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export interface SecurityOptions {
  /** Campaign encyclopedia module flag, read once at startup. */
  encyclopedia?: boolean;
}

export function securityMiddleware(port: number, opts: SecurityOptions = {}): RequestHandler {
  const encyclopedia = opts.encyclopedia === true;
  return (req, res, next) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }
    res.setHeader('Content-Security-Policy', buildCsp({ encyclopedia }));
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    if (!isAllowedHost(req.headers.host, port)) {
      res
        .status(403)
        .json({ error: 'This address is not allowed. Open the master screen from the link the launcher prints.' });
      return;
    }
    if (isStateChanging(req.method) && !isAllowedOrigin(req.headers.origin, port)) {
      res.status(403).json({ error: 'The request came from another site and was blocked.' });
      return;
    }
    next();
  };
}
